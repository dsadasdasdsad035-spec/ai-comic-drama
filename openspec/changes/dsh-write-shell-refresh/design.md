# Design

## Context

见 `proposal.md`。当前写路径：`DSH → creative-tools → POST /api/studio/tools/execute → StudioToolBridge.invoke → createBuiltinPlatformTools({ onProjectDataChanged: () => {} }) → applyProjectDraft / patchProject`。外壳 `App.tsx` 在 `refreshProjectSnapshot` 中已实现 `getProject` + `hydrateCanvasShots`，但仅壳内 `patchProject` 路径会间接触发，创意 iframe 与外层 React 树隔离。`GET /api/project` 已含 `revision`（写时递增），`postStudioCanvasContext` 已支持 `projectRevision`。

## Goals / Non-Goals

**Goals:**

- 创意宿主写工具成功后，同窗口顶栏项目的外壳自动对齐落库 + 推送实况 revision。
- 复用 `refreshProjectSnapshot` 与 `shots-write-mode-and-refresh` / `studio-read-live-view` 语义，不新造水合逻辑。
- 桌面与浏览器行为一致；创意 keepalive 后台也能对齐。

**Non-Goals:**

- 不向 DSH 宿主注入脚本或改其 UI。
- 不做全站 WebSocket；不做多标签页跨设备同步。
- 不恢复应用内 Pi 创意路径。
- 不在本变更中解决并发写冲突（维持 last-write-wins）。

## Decisions

### D1 应用进程内「项目变更序」+ 轻量查询接口

在 `server/index.mjs`（或紧邻模块）维护 `Map<projectName, { revision, updatedAt }>`，在 `StudioToolBridge.invoke` 成功返回且工具属于**落库写集合**时更新（与 `creative-tools` 的 `DESTRUCTIVE_TOOLS` / 相关 `submit_*` 对齐，实现层单源常量或共享列表）。

新增 `GET /api/studio/project-revision?name=`（或 `GET /api/studio/project-sync?name=`）：返回 `{ ok, name, revision }`，只读当前 `studioProject` 记录与库中 revision，**不**拉全项目。供壳轮询，避免每次比对都打全量 `getProject`。

- **备选 A**：仅靠 `execute` 响应体带 `projectRevision` —— DSH iframe 拿不到父页，除非注入 bridge，否决。
- **备选 B**：SSE 推送 —— 需长连接与鉴权，首版过重，否决。

### D2 桥接层 `onProjectDataChanged` 接到变更序

`StudioToolBridge.ensureLoaded` 将 `onProjectDataChanged` 改为调用服务注册的 `bumpStudioProjectRevision(projectName)`（从 invoke 上下文的项目名取值）。与 `projectDraft` 内既有回调串联，写成功只 bump 一次。

失败路径、`ok: false`、审批未执行的工具 **不** bump。

### D3 外壳 `useStudioProjectSync` 钩子

在 `App.tsx`（或 `src/creative/useStudioProjectSync.ts`）：

1. 依赖 `readyProject`、`projectSnapRef.current?.revision`、`studioMount`（mounted/visible）。
2. 当 `readyProject` 非空且（创意已挂载 **或** 距上次全量刷新超过阈值）时，每 1.5–2s 请求 `project-revision`；`document.visibilityState === 'visible'` 且在 `visibilitychange` / `window.focus` 时立即探一次。
3. 当 `remote.revision > localRevision`：串行 `await refreshProjectSnapshot()`，再 `postStudioCanvasContext`（用刷新后的 `projectSnapRef` revision，绕过 400ms 防抖可用立即 flush 封装）。
4. 刷新期间加简单 mutex，避免叠两次 `getProject`。

创意 tab 可见时 polling；keepalive 隐藏时降频（如 5s）仍可接受，或在 `keepalive` 容器 `data-active=false` 时用低频 + 揭示时立即探针。

### D4 与手改画布共存

刷新走现有 `hydrateCanvasShots`：按 `shotId` 复用节点位置，不传 `fit`。写后实况 `projectRevision` 与库一致后，读工具 overlay 规则不变。若用户在刷新瞬间有未防抖落库的手改，仍以 revision 门控：旧 revision 实况不盖新 DB（已有行为）。

### D5 测试策略

- 桥接单测：`invoke submit_*` mock 写成功 → revision 端点升高。
- 可选轻量 HTTP 测试：execute 后 GET revision。
- 手测清单：创意批准 `submit_shots` → 不切项目打开画布；`submit_episodes` → 分集目录。

## Risks / Trade-offs

- [轮询开销] → 仅 revision 字段、创意挂载时 2s 间隔；隐藏态降频。
- [多标签同项目] → 每标签独立轮询，可能重复 `getProject`；可接受。
- [写工具列表漂移] → 与 `DESTRUCTIVE_TOOLS` 不同步时漏刷或误刷；在 `studio-tool-bridge` 或共享模块导出 `PLATFORM_WRITE_TOOL_NAMES` 单源。
- [刷新与用户操作竞态] → mutex + 不改变视口 fit；极端情况下用户同时拖节点可能下一帧被水合覆盖 —— 与导入写回同类，文档说明写后勿立刻手改同一镜。

## Migration Plan

1. 服务端：revision bump + GET 接口 + 桥回调。
2. 客户端：hook + `App.tsx` 挂载。
3. 验证手测与现有 `npm run test:studio-tools` 全绿。
4. 回滚：去掉 hook 与端点，行为回到「需重启/切项目」；数据无迁移。

## Open Questions

- 是否在 `POST /api/studio/tools/execute` 成功响应中附带 `projectRevision` 供将来 DSH 侧展示「已同步画布」——首版可只做轮询，响应字段作增量增强。