# Design

## Context

See `proposal.md` for motivation. Current constraints that shape the approach:

- Export returns a transient URL from `/api/assemble`; `Preview.tsx` keeps it in component state, so nothing survives a refresh and there is no stable object to publish.
- All HTTP routes live in `vite.config.ts`; server logic is extracted into `server/*.mjs` with sibling `.d.mts` declarations. SQLite access is centralized in `server/db.mjs`; tables are created with `CREATE TABLE IF NOT EXISTS` on every open, so new tables are additive.
- `playwright-core` is already a dependency and existing verification scripts launch the system Chrome (`channel: 'chrome'`). There is no bundled Chromium download.
- `ffmpeg` is resolved through `server/ffmpeg-host.mjs`; it already probes duration, extracts frames, and muxes exports.
- The app is a local, single-user tool. Project media is local; there is no upload service or object storage.
- Chinese platforms do not expose a general publish API to ordinary creators. Douyin's official path is enterprise-only and ends in a manual confirmation page; Bilibili's open platform is enterprise/agency scoped; Toutiao and WeChat Channels have no general third-party publishing API. Browser automation of the creator backend is the only V1-viable path, and it is inherently brittle.

## Goals / Non-Goals

**Goals:**

- Give every exported MP4 a stable, persisted identity so publishing can reference it across reloads.
- Make one publish action cover several platforms while keeping per-platform title, description, tags, cover, and publish mode.
- Keep account sessions local and make login failure, platform drift, and partial success explicit rather than guessing.
- Stop automatic flows before irreversible platform actions.
- Produce a usable manual fallback (publish package) when automation is unavailable.

**Non-Goals:**

- No unattended final publishing, no scheduler, no queue that fires while the app is closed.
- No multi-account UI, account groups, team permissions, or agency workflows.
- No official API integration, no platform analytics/comment/message collection.
- No automatic re-render or reframing for vertical platforms; aspect mismatch is a warning only.
- No anti-bot evasion, fingerprint spoofing, captcha solving, or automatic likes/comments/follows.

## Decisions

### 1. Deliverable is created on the server as part of export

`/api/assemble` creates a `deliverables` row when the export job succeeds, using the final file path, resolution, duration, SRT sidecar, and the `project` / `episode` carried in the request.

Alternatives considered:

- Client POST after export completes: loses the record if the tab closes, and allows two clients to create competing records for the same file.
- Ad-hoc file scan of `public/exports`: no project/episode binding, no version, no stable ID.

Version is `max(version)+1` per project + episode. The assemble response gains a `deliverable` object so `Preview` can offer "发布到平台" immediately. Imported MP4s use the same table with `source='import'` and are streamed to disk from a raw request body, avoiding a multipart dependency.

### 2. Platform capabilities live in one server-side registry

`server/publish-platforms.mjs` exports a static registry: platform id, label, supported modes, required cover aspects, title/description/tag limits, known duration/size ceilings, composer URL, and whether direct publish is currently enabled. Adapters read the same entry.

Alternatives considered:

- Store capability rules in SQLite: adds migrations and a settings UI for values that are UI defaults, not user preferences.
- Duplicate limits in frontend and backend: guaranteed drift.

The UI fetches the registry from `/api/publish/platforms`; it never hard-codes platform limits. Server-side preflight is the authority, so the UI can display a stale registry without allowing an invalid publish.

### 3. Accounts are local Chrome profiles, not stored cookies

Each account binds a platform to a profile directory under `.publish-profiles/<accountId>/` (mode `0700`, gitignored). Login launches a visible Chrome via `launchPersistentContext` and waits for the creator backend to show a logged-in state. No cookie/storage-state export, no credential fields in SQLite.

Alternatives considered:

- Import cookies from a file: higher risk, poor UX, and violates the "don't surface secrets" requirement.
- `storageState` in the database: same risk plus a plaintext secret store.
- Bundled Chromium: larger install, and the project already standardizes on system Chrome for verification.

Concurrency is 1 browser job globally. This bounds memory, keeps failures attributable, and avoids hammering platforms. Execution is headed by default; a visible window is also the escape hatch for captcha or SMS verification. The browser is closed when a job ends; the profile persists on disk.

### 4. Draft-first, confirmation-gated publishing

Three modes exist:

- `draft`: upload and fill metadata, stop at the platform draft or confirmation page. This is what "自动上传" means in V1.
- `publish`: user-initiated only; requires the per-action confirmation dialog listing every platform and account.
- `package`: generate a local publish package, no browser.

Automatic triggers (after a successful export) can only create `draft` jobs. An adapter exposes a `submitFinal` action that the queue refuses to call in automatic mode. This is enforced in the queue, not just the UI.

Alternatives considered:

- Auto-publish toggle per account: rejected for V1 because platform review and account risk make an unattended final click hard to justify, and the user cannot see what was posted.
- Draft-only with no direct publish: too restrictive for a local tool where the user has already confirmed the content.

### 5. Preflight is a server endpoint

`POST /api/publish/preflight` receives the deliverable, target list, and copy/cover config. It returns `issues[]` with `level: 'block' | 'warn'`, `code`, `target`, `field`, and a message. The UI debounces calls and renders results; it does not reimplement limits.

Alternatives considered:

- Pure client validation: cannot verify file existence, login state, or ffprobe metadata.
- Pure server validation on submit: users discover problems only after pressing publish.

Blocking checks: missing deliverable file, missing/invalid account, account expired or unknown, unsupported mode, title over limit, required cover missing, AI declaration unconfirmed, file over a known platform ceiling. Warnings: aspect mismatch, empty description, tag count over recommendation, unknown duration/size, platform known to be selector-fragile.

### 6. Jobs are persisted, queued in memory, and never auto-resume

`publish_jobs` is the durable state; `publish_events` is an append-only timeline. A single in-process queue drains jobs with concurrency 1. On server start, any job left `queued` / `uploading` becomes `unknown` with a "服务重启" event; it is never silently retried.

Idempotency key is `deliverableId|platform|accountId`. Creating a job first looks for an active state with the same key and returns it. Explicit "重新发布" increments `run_no` and creates a new job. Retry creates a new job from the same target but only for states that permit retry (`failed`, `expired`, `unknown` after user action); successful targets are never resubmitted by a batch retry.

Alternatives considered:

- In-memory jobs only: lose history on restart and cannot drive the records view.
- One job per deliverable containing all targets: partial failure becomes ambiguous and retry would resubmit successful platforms.
- Bull/BullMQ/Redis: a service to operate for a single-user local tool.

### 7. Publish package is a directory plus optional zip

`POST /api/publish/packages` writes `public/publish-packages/<job-or-deliverable>/` containing the MP4, prepared covers, SRT when present, and `copy.json` with master copy, per-platform overrides, AI declaration, and platform notes. If a system `zip` binary is available, it also writes a zip; otherwise the directory is the deliverable. No new archive dependency.

### 8. UI follows the existing workbench shell

`PublishBoard` is a project view registered between 画布 and 设置. It uses `WorkbenchBar` for scope/settings/actions and the existing theme tokens.

```text
+----------------------------------------------------------------------------------+
| 发布台   [待发布] [发布记录] [平台账号]        项目/集来自全局带      [导入成片]  |
+---------------------+----------------------------------------+-------------------+
| 成片列表            | 发布配置（手风琴）                     | 发布检查          |
|  248px              | 平台与账号 -> 文案 -> 封面 -> 方式      |  300px            |
|                     |                                        | 阻断 / 警告       |
+---------------------+----------------------------------------+-------------------+
| 底部操作条：保存草稿                         发布到 N 个平台                    |
+----------------------------------------------------------------------------------+
```

Breakpoints: at `<=1200px` the deliverable rail becomes a horizontal strip and the inspector becomes a collapsible bottom sheet; at `<=900px` the composer is single-column with a fixed bottom action bar. Only one accent button per view: the publish action. Status uses text plus icon, never color alone. Platform brand colors appear only in 16px badges. Time, duration, counts, and versions use `--font-mono` with tabular numerals.

The top bar gains a "发布" tab. Existing global controls keep their order; the publish tab carries a small running/failed count. Preview shows "发布到平台 ->" only after a successful export and passes the new `deliverableId` to `App`, which switches to the publish view and preselects the deliverable.

### 9. Server-side file handling is path-allowlisted

Deliverable and cover URLs are accepted only under `/exports/`, `/videos/`, `/generated/`, or the project asset directory. Every resolved path must remain inside its allowed root after symlink resolution. Imported files are size-capped (2 GB) and extension-checked (`.mp4`). Cover uploads reuse the existing image size cap and decode path. Error text is sanitized (strip query strings and token-like values) and capped at 500 characters before persisting or displaying.

## Data Model

New tables in `server/db.mjs`, all `CREATE TABLE IF NOT EXISTS`:

| Table | Purpose | Key columns |
| --- | --- | --- |
| `deliverables` | 成片版本与发布配置 | `id`, `project`, `episode`, `version`, `title`, `url`, `srt_url`, `width`, `height`, `duration`, `bytes`, `source`, `config` JSON, `created_at` |
| `publish_accounts` | 平台账号绑定 | `id`, `platform`, `label`, `profile_dir`, `status`, `last_checked_at`, `auto_draft`, `created_at`, `updated_at` |
| `publish_jobs` | 一次平台目标执行 | `id`, `idempotency_key`, `run_no`, `deliverable_id`, `project`, `platform`, `account_id`, `mode`, `state`, `stage`, `error_code`, `error_message`, `work_url`, `created_at`, `started_at`, `ended_at` |
| `publish_events` | 回执时间线 | `id`, `job_id`, `state`, `stage`, `message`, `created_at` |

`deliverables.config` shape:

```json
{
  "master": { "title": "", "description": "", "tags": [], "aiGenerated": true },
  "cover": { "9:16": "/exports/covers/x.jpg", "16:9": "/exports/covers/y.jpg" },
  "targets": {
    "douyin": { "selected": true, "accountId": "pa-...", "mode": "draft",
      "override": { "title": "", "description": "", "tags": [] } }
  }
}
```

JSON is appropriate here for the same reason `shots.extra` uses it: the shape will evolve as platforms are added, and no query needs to filter inside it. Account IDs, job states, and deliverable identity are normalized columns because they are queried and joined.

## API Surface

| Method / path | Purpose |
| --- | --- |
| `GET /api/publish/health` | Browser availability, Chrome path, ffmpeg, adapter readiness |
| `GET /api/publish/platforms` | Static capability registry |
| `GET /api/deliverables?project=&episode=` | Deliverable versions with config summary |
| `POST /api/deliverables/import` | Raw-body MP4 import with `X-File-Name` |
| `PATCH /api/deliverables/:id` | Save publish config |
| `POST /api/deliverables/:id/covers` | Extract frame or save uploaded cover per aspect |
| `GET /api/publish/accounts` | Accounts without profile paths or secrets |
| `POST /api/publish/accounts/connect` | Start visible login, returns `loginId` |
| `GET /api/publish/accounts/connect/:loginId` | Poll login progress |
| `POST /api/publish/accounts/:id/check` | Session health check |
| `DELETE /api/publish/accounts/:id` | Remove account and profile |
| `POST /api/publish/preflight` | Blocking/warning issues |
| `POST /api/publish/jobs` | Create or reuse jobs for selected targets |
| `GET /api/publish/jobs?project=&episode=&active=` | Records and task center summary |
| `GET /api/publish/jobs/:id` | Job plus event timeline |
| `POST /api/publish/jobs/:id/cancel` | Cancel and close browser |
| `POST /api/publish/jobs/:id/retry` | New job for the same target |
| `POST /api/publish/jobs/:id/mark-published` | Manual confirmation with optional work URL |
| `POST /api/publish/packages` | Write publish package |

## State Machine

```text
draft --enqueue--> queued --> uploading --> awaiting_confirmation --> (manual) published
                                  |                    |
                                  |                    +--> submitted --> published
                                  |                                   \--> rejected
                                  +--> failed
queued/uploading --> cancelled
any active state --> expired   (session lost)
any active state --> unknown   (no verifiable result / server restart)
failed/expired/unknown --retry--> queued (new run_no, same target)
```

Allowed terminal states: `published`, `rejected`, `failed`, `cancelled`. `unknown` is terminal for the current run but retryable by explicit user action. A direct `publish` job may return `submitted` only when the adapter can read a verification signal; otherwise it returns `unknown` and the UI asks the user to confirm in the platform backend.

## Risks / Trade-offs

- **Platform page changes break selectors** -> Each adapter is isolated, exposes a `selectors_changed` error code, and ships a manual verification checklist. A failed selector stops the job; it never falls back to blind clicking. Platforms whose adapter cannot be verified start as `manualOnly` and only offer draft/package.
- **Account restriction risk from automation** -> Default to draft, headed browser, concurrency 1, no evasion, no bulk variants, and explicit user confirmation for final actions. The UI states that automation may violate platform terms.
- **Long uploads hold the dev server** -> Uploads run in async jobs with per-stage timeouts (session 30s, upload 10min, job 15min). Cancel closes the browser context. The queue is concurrency 1, so other jobs wait.
- **Partial success is the normal case** -> Per-target jobs and per-target retry; no batch "retry all" that could resubmit successful platforms.
- **Deliverable and package disk growth** -> Deliverables reference existing export files rather than copying; packages are created on demand and listed for manual cleanup. No background deletion in V1.
- **16:9 source on vertical platforms looks wrong** -> Preflight warns; V1 does not re-render. Users can export a dedicated vertical version and import it as a separate deliverable.
- **AI disclosure compliance** -> `aiGenerated` defaults to true and must be confirmed; the value is written into job metadata and `copy.json`. Auto-draft can only be enabled after a one-time confirmation that covers disclosure.
- **Deployment shape** -> Browser automation requires a local machine with Chrome and a process that stays alive. If the app is deployed remotely, `/api/publish/health` reports automation unavailable and only the package path is offered. `playwright-core` must move from `devDependencies` to `dependencies` if a production server is extracted.

## Migration Plan

1. Add the four tables via `CREATE TABLE IF NOT EXISTS`; no backfill and no change to existing rows.
2. Add `.publish-profiles/` and `public/publish-packages/` to `.gitignore`.
3. Existing `public/exports/*.mp4` files are not auto-imported; users can import them explicitly. This avoids guessing project/episode for old files.
4. Rollback: hide the publish tab and stop registering publish routes; the new tables remain inert and can be dropped manually. Profiles and packages are separate local directories and can be deleted without touching project data.

## Open Questions

None that affect the specs, approach, or task breakdown. Selector baselines and platform-specific limits will be validated during implementation against a logged-in account; if a platform cannot be verified, it ships as manual-only rather than blocking the release.
