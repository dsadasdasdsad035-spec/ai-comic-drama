# Proposal

## Why

画布分镜卡在卡脚同时提供「出片」，且要求先有 `refImage` 才能点击，把「出图 → 出片」焊成一条流水线；而 Inspector 视频 Tab 与 `buildShotVideoRequest` 已支持仅凭连线参考或视频素材出片。用户在画布上只想管静帧时，仍被卡面暗示必须先出图再出片，与已拆分的四页 Inspector 心智重复、且规则不一致。

## What Changes

- 分镜卡 **移除** 卡脚「出片 / 重出片」按钮及相关运行态文案；卡上 **保留** 卡头「生成」出图与出图中的取消/错误态。
- 单镜出片 **唯一主路径** 为 Inspector「视频」Tab 底栏「生成视频」（及头部 chip 跳转）；**保留** 多选浮动条上的批量「出片」。
- 出片可执行条件 **不再** 在分镜卡上单独禁用；与引擎一致：无当前画面时，若有合格参考图/视频素材仍可在 Inspector 出片。
- Inspector 默认 Tab **不变**：已有当前画面 → 默认「视频」；尚无画面 → 默认「画面」。
- **不做**：卡上出图浮层、镜头表内出图/出片、取消「推画布」、改 API 或 `ShotData` 模型。

## Capabilities

### New Capabilities

- `storyboard-shot-card`：画布分镜卡在空间布局视图中的生成入口与预览行为（出图在卡上、出片不在卡上）。

### Modified Capabilities

- （无）主规格库中尚无独立的 `shot-inspector-layout` 主 spec；Inspector 出片入口行为由本变更的 `storyboard-shot-card` 与既有 README/实现共同约束，不在此重复 delta。

## Impact

- 前端：`src/ShotNode.tsx`（移除出片 UI 与 `generateVideo` 绑定）、`src/theme.css`（`.shot-vid` 等可删或保留未使用样式）、`src/App.tsx`（若 `generateVideo` 仅传给 ShotNode 可收窄 props）。
- 验收：`verify-shot-inspector.mjs` 或新增 `verify-shot-card.mjs` 断言卡上无出片；检索并更新仍点击 `.shot-vid` 的脚本。
- 文档：`README.md` 画布与 Inspector 小节各补一句用户路径。
