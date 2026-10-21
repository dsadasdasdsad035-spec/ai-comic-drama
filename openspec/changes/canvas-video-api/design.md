# Design

## Context

当前 `/api/seedance` 路由位于 `vite.config.ts` 的 Vite dev 中间件中。它把请求拼成 CLI 参数，用 `execFile('python3', seedance.py create ... --wait --download ...)` 启动项目目录外的脚本，再从 stdout 解析 `Saved to:` 与 `Last Frame URL:`。CLI 内部实际调用的是方舟视频任务 API：

```
POST {base}/contents/generations/tasks   -> { id }
GET  {base}/contents/generations/tasks/{id}
     -> { status, content: { video_url, last_frame_url }, error }
```

前端 `src/api.ts` 只依赖本地 `/api/seedance` 的 POST/GET 契约与内存任务状态，不关心后端如何出片。dev server 只监听 `127.0.0.1`，服务商无法回调本地地址，因此只能由服务端主动轮询。成功响应里的视频与尾帧都是限时 URL，必须及时下载。

## Goals / Non-Goals

**Goals:**

- 用纯 HTTP 完成提交、轮询、下载，彻底移除 Python/子进程依赖。
- 保持前端 `/api/seedance` 契约与画布出片交互不变。
- 提交前给出可读的参数与凭据错误，不把服务商原始响应直接透给用户。
- 让新的视频客户端可以脱离 Vite 与真实网络做验证。

**Non-Goals:**

- 不改用其他视频服务商，不实现通用视频协议适配。
- 不做任务跨 dev server 重启恢复。
- 不修改出片 UI、模型选择交互、计价规则。
- 不把整个 API 层抽成独立 server（部署清单的第 1 项）。

## Decisions

### 1. 保留 `/api/seedance` 与内存任务表，只替换后端实现

前端 POST 拿到本地 job id、每 3 秒 GET 查询的模式保持不变；`videoJobs` 仍放在路由层。提交成功后把服务商 `taskId` 一并记入 job，便于日志排查和未来恢复。

**替代方案**：让浏览器直接轮询服务商。需要把 Key 暴露到前端，且下载与尾帧落盘无人负责，放弃。

### 2. 服务端主动轮询，不使用 callback URL

dev server 没有公网可达地址，回调不可行。提交后启动一个 5 秒间隔的轮询循环（`setTimeout` 串行，不用 `setInterval` 防止重叠），直到终态或 10 分钟超时。10 分钟沿用现 CLI 的 `execFile` timeout，短于前端 12 分钟等待。

**替代方案**：把轮询放在前端。前端仍需经本地代理访问服务商，代理层反而更复杂；放弃。

### 3. 复刻 CLI 已经验证过的请求体

请求体与 CLI 的映射保持一致，避免重新猜协议：

```
{
  model,
  content: [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url }, role: "first_frame" }
    // 或 1~4 个 role: "reference_image"
    // 首帧模式下可追加 role: "last_frame"
  ],
  ratio,
  duration: seconds,
  resolution,
  camera_fixed: boolean,
  return_last_frame: true
}
```

端点使用 `${provider.baseUrl}/contents/generations/tasks`，而不是硬编码方舟域名。参考图模式与首帧模式分别走 `videoRef` / `video` 模型能力，沿用现有的 `pickModel` 逻辑。`last_frame` 与 `reference_image` 互斥、参考图最多 4 张的规则保持不变。

**替代方案**：把 `--ratio`、`--duration` 等拼进文本提示词。结构化字段更清晰，且 CLI 已证明顶层字段可用；放弃。

### 4. 图片统一转 data URL，并加体积上限

复用现有 `resolveRef`：`data:` 与 `http(s)` 原样通过，本地路径读文件转 base64。方舟无法访问 `127.0.0.1`，本地路径必须先转 data URL。逐图 `try/catch`，失效或超限的图片跳过并记录在响应的 `skipped` 中；全部失效则 400。单图上限沿用 CLI 的 30MB。

旧的 `prep`（把 data URL 写临时文件再让 CLI 读回）删除，减少一次落盘和 base64 往返。

### 5. 抽出 `server/video.mjs` 作为纯客户端模块

`vite.config.ts` 只负责设置解析、鉴权、路由与 job 表；新模块提供：

- `videoCapsFor(model)`：模型档位查询。
- `buildVideoPayload({ prompt, images, ratio, seconds, resolution, cameraFixed, returnLastFrame })`：纯函数，生成请求体。
- `submitVideoTask({ baseUrl, apiKey, payload })`：POST，返回 `taskId`。
- `pollVideoTask({ baseUrl, apiKey, taskId, intervalMs, timeoutMs })`：轮询到终态。
- `downloadVideoArtifacts({ job, dirs, fetchImpl })`：下载视频与尾帧。

模块不读全局设置、不依赖 Vite，便于用本地 mock HTTP server 验证提交、轮询、失败、超时与下载。这也符合现有 `server/db.mjs`、`server/data.mjs` 的组织方式。

**替代方案**：继续把逻辑堆在 `vite.config.ts`。文件已超过 80KB，且无法脱离 dev server 测试；放弃。

### 6. 模型档位表按模型族维护，未登记模型放行

已知档位：

| 模型族 | 时长 | 分辨率 |
| --- | --- | --- |
| `doubao-seedance-1-0-*`（含 lite i2v） | 2~12 秒 | 480p / 720p / 1080p |
| `doubao-seedance-1-5-*` | 4~12 秒 | 480p / 720p / 1080p |
| 其他 | 不校验 | 不校验 |

越界时返回 400，消息包含模型 ID、请求值与允许范围。**不静默取整**：改写时长会让成片长度偏离分镜与计价。未登记模型按客户端参数提交，由服务商判断，避免新模型被本地表挡住。

### 7. 失败语义与重试边界

- POST 不自动重试。视频任务按次计费，重试可能产生重复扣费；提交失败直接把服务商错误返回给前端。
- 轮询 GET 遇到网络错误或 5xx 时连续容忍 2 次，第 3 次标记失败；401/403/404 立即失败。
- 服务商 `failed` / `expired` / `cancelled` 统一映射为本地 `failed`，消息保留 `error.code` 与 `error.message`。
- 视频下载失败置为 `failed`，不返回半成品地址；尾帧下载失败仅清空 `tail`，不影响 `succeeded`。
- 超时置为 `failed`，消息提示等待超时，并保留 `taskId` 供排查。

### 8. dryRun、健康检查与提示同步调整

- `dryRun` 返回 `request`（即将提交的 JSON）与 `mode`/`model`/`skipped`，不再返回 CLI `args`，也不发起网络请求。
- `/api/health` 的 `videoReady` 改为默认视频渠道是否存在可用 Key，不再检查 `seedance.py` 是否存在。
- 删除 `SEEDANCE_CLI`、`runSeedance`、`kind: 'no-cli'`；设置页与部署清单中的 CLI 表述同步更新。

## Risks / Trade-offs

- **Job 表在 dev server 重启后丢失** → 与当前行为一致；job 中保留 `taskId`，后续可基于它做恢复，本次不实现。
- **data URL 体积与内存** → 单图 30MB 上限、逐图跳过；参考图最多 4 张，避免请求体失控。
- **服务商 URL 限时** → 成功回调后立即下载；下载失败按失败处理，不把过期 URL 交给画布。
- **模型档位表随服务商变化而过时** → 只约束已知模型族，未知模型放行；表集中在 `server/video.mjs` 一处，更新成本低。
- **第三方 Base URL 可能只兼容 OpenAI 协议** → 仍只允许 `ark` 类渠道；自定义 `baseUrl` 视为方舟协议兼容中转。
- **轮询任务在页面关闭后继续** → 与 CLI 时代一致，产物仍会落盘；若未来需要取消，可调用 DELETE 任务接口。
- **重复扣费** → 不对 POST 做自动重试，这是有意的保守选择。

## Migration Plan

1. 新增 `server/video.mjs` 与对应的 mock 验证脚本。
2. 替换 `/api/seedance` 路由，删除 CLI 相关常量与函数。
3. 更新 `/api/health`、设置页提示、`DEPLOY-CHECKLIST.md`。
4. 更新 `verify-providers.mjs` 与 `verify-videoref-multi.mjs` 的 dryRun 断言。
5. 回归：dryRun 检查请求体 → 首帧模式真实出片一次 → 参考图模式一次 → 尾帧下载与下一镜接龙。
6. 回滚：还原单个提交即可；本次不涉及数据库 schema 或持久化数据迁移。

## Open Questions

无。
