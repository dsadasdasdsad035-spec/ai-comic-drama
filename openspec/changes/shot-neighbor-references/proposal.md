# Proposal

## Why

画布上的镜头目前只能参考角色卡和素材卡，不能把上一镜/下一镜已经生成的画面作为参考；同时视频出片还保留一套自动尾帧约束和尾帧接龙，靠 `last_frame`、`return_last_frame` 和 `tail_image` 维持连续性。用户希望把镜头间的连续性改成显式选择：手动勾选上一镜/下一镜画面，AI 画面和视频出片都使用；不再使用自动尾帧和尾帧接龙。

## What Changes

- **BREAKING** 删除视频尾帧约束和尾帧接龙：不再提供「以下一镜画面作尾帧约束」，不再保存/展示本镜尾帧，不再支持「设为下一镜首帧 / 用上一镜尾帧作首帧」。
- **BREAKING** 移除视频请求的 `lastFrame` / `returnLastFrame`，服务端不再提交 `last_frame`、不再请求/下载 `return_last_frame` 尾帧；`tailImage` / `tail_image` 不再读写，旧字段保留在 SQLite `extra` 中但不展示。
- 新增手动「上一镜 / 下一镜」画面参考：只列同集相邻镜头，只有已生成画面才可选；下一镜未出图时置灰；目标镜头不能参考自己。
- 参考关系复用 `refIds`，用关系 token `shot-prev` / `shot-next` 持久化，不锁定具体 shot id；镜头重排后仍指向当前相邻镜头。
- 相邻参考同时进入 AI 画面生成和视频出片：AI 画面继续使用 Seedream 最多 10 张参考图；视频使用最多 4 张 `reference_image`（参考视频模式同样最多 4 张图片 + `reference_video`）。
- 明确视频参考优先级：当前镜画面 → 角色图 → 相邻分镜 → 场景/道具 → 3D 调度关键帧；超过 4 张时提示被省略项，不静默丢图。
- 相邻镜头之间已有 `cut/transition` 叙事边，不再额外画一条参考边；用右键勾选、Inspector 参考摘要或卡片徽标表示「参考上一镜/下一镜」。
- 参考视频协议保持不变：`reference_video`、`reference_image` 的结构和 `@视频N` / `@图像N` 语义不变；只删除尾帧字段，并在相邻参考参与时重新编号图片。
- 记录与在途变更的协调：本变更取代 `canvas-video-api` 和 `schedule-video-reference` 中保留尾帧/尾帧接龙的要求；实施前必须先修订或归档这两个变更，本变更不直接修改它们的文件。
- 不包含：任意非相邻镜头参考、跨集自动参考、自动循环参考、删除磁盘上已存在的旧尾帧文件、重做视频供应商协议。

## Capabilities

### New Capabilities

- `shot-neighbor-references`: 镜头手动选择同集上一镜/下一镜画面作为参考，覆盖 AI 画面和视频出片，并明确参考数量、优先级、缺失状态和参考关系持久化。

### Modified Capabilities

无。现有主 spec 没有已归档的视频生成能力；`canvas-video-api` 与 `schedule-video-reference` 是两个在途变更，本变更在 tasks 中安排先协调/归档它们，不直接修改其文件。

## Impact

- 代码：`src/App.tsx`（相邻参考、`collectRefImgs`、`generateOne`、`generateVideoOne`、删除尾帧函数/状态）、`src/Inspector.tsx`（尾帧 UI、参考摘要）、`src/types.ts`、`src/api.ts`、`src/shotSync.ts`（移除 `tailImage` / `lastFrame` / `returnLastFrame` 映射）、`server/video.mjs`、`server/video.d.mts`、`vite.config.ts`。
- 数据：旧镜头里的 `tail_image` 保留在 SQLite `shots.extra` 中，但新代码不再读取/展示/写入；参考关系继续写 `refIds`，新增 `shot-prev` / `shot-next` token。无需数据库迁移。
- UI：右键参考菜单增加上一镜/下一镜；Inspector 删除尾帧约束/尾帧条/上一镜尾帧按钮；视频参考数量超限时显示省略清单。
- 视频：模式收敛为「首帧 / 1~4 张参考图 / 参考视频 + 1~4 张参考图」；首帧模式不再发送 `last_frame`，所有模式不再请求 `return_last_frame`。
- 测试：退役 `verify-tail.mjs`；更新 `verify-schedule3d.mjs`、`verify-video-api.mjs`、`verify-video-ref-ui.mjs`、`verify-video-ref-api.mjs`；新增相邻参考 UI/请求、优先级/上限、无尾帧字段和旧数据兼容回归。
- 协调：实施前先处理 `canvas-video-api`（10/12 tasks）与 `schedule-video-reference`（21/23 tasks）中的尾帧要求；否则归档后主 spec 会与本变更冲突。
