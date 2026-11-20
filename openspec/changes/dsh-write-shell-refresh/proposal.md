# Proposal

## Why

创意会话（DSH 专家）经 `StudioToolBridge` 调用 `submit_*` 等平台写工具时，数据已在应用进程落库，但外层分镜壳（`App.tsx` 的画布、分集目录、角色/素材视图）仍持有打开项目时的内存快照。`onProjectDataChanged` 在桥接侧为空实现，且创意 iframe 与壳之间无通知通道，操作员必须重启桌面端或切换项目才能看到专家写入——与「读工具每次拉最新库」形成割裂，也违背 `studio-read-live-view` 对写后推送实况的意图。

## What Changes

- 在服务端成功执行**会修改当前顶栏项目**的平台写工具后，发出可供浏览器壳订阅的「项目数据已变更」信号（含项目名与 revision）。
- 外壳在顶栏已选同一项目时，收到信号后 MUST 调用既有 `refreshProjectSnapshot`（及 `postStudioCanvasContext` 对齐 revision），重载分镜/分集/相关 state 并水合画布，**不传 `fit`** 以免打断视口。
- 写失败、审批拒绝、校验失败时 MUST NOT 触发壳刷新。
- 创意 iframe 常驻（keepalive）时，壳在后台也应能收到变更并在用户切回分镜/分集时已是新数据；可选在切离创意 tab 时做一次对齐轮询作为兜底。
- 不恢复已停用的应用内 Pi 创意路径；不改动 DSH 宿主 UI 本身。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-tool-bridge`：写工具成功落库后，应用 MUST 向操作员可见壳暴露可观测的变更通知（与工具 execute 响应或独立轻量接口），行为契约见 delta spec。
- `canvas-shots-workbench`：经创意宿主写回的分镜/分集数据 MUST 在无需重启应用的前提下反映到画布与时间线（与壳刷新联动）。
- `project-context`：当前顶栏项目被外部写路径（非壳内 UI 直接 `patchProject`）修改时，壳 MUST 重载该项目上下文，避免跨视图展示陈旧快照。

## Impact

- `server/studio-tool-bridge.mjs`、`server/index.mjs`（变更信号或 revision 端点、execute 响应字段）。
- `src/App.tsx`、`src/creative/StudioFrame.tsx` 或新建 `src/creative/useProjectWriteSync.ts`（订阅/轮询 + `refreshProjectSnapshot` + `postStudioCanvasContext`）。
- 测试：`tests/studio-tool-bridge.mjs`、集成或前端钩子单测；可复用手动验收（创意内 `submit_shots` → 切画布可见）。
- 桌面 Electron 与浏览器同源壳行为一致，无 Electron 专有小包。