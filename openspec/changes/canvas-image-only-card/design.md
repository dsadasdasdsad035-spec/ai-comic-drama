# Design

## Context

`ShotNode` 在卡头有 `generate(id)`，在卡脚有 `generateVideo(id)`，且 `disabled={vidRunning || !data.refImage}`。Inspector 底栏与 `buildShotVideoRequest`（`videoPrompt.ts`）允许无 `refImage` 时在满足参考条件下出片。批量条在 `App.tsx` 的 `runOnSelected('video')` 已存在。

## Goals / Non-Goals

**Goals:**

- 删除卡脚出片 UI 与卡上对 `refImage` 的出片门禁，使画布卡只承载「静帧生产 + 预览」。
- 收窄 `ShotNode` props：`generateVideo` 若仅卡脚使用则移除传递链。
- 验收与 README 与用户路径一致。

**Non-Goals:**

- 卡上出图浮层、镜头表内生成、默认 Tab 策略调整、API/数据模型变更。
- 删除 `.shot-vid` CSS 可作为清理项，非必须（tasks 里 optional）。

## Decisions

1. **直接删除卡脚区块，不 feature flag**  
   行为简单、无远程配置需求；回滚即恢复 `ShotNode` 片段。

2. **保留卡上静帧/视频预览与 `vidRunning` 遮罩**  
   出片进行中用户仍应在卡上看到「出片中」叠加层；仅移除触发按钮，不删 `generateVideoOne` 的全局状态展示。

3. **Props 清理**  
   `ShotNode` 从 `NodeProps` 解构中移除 `generateVideo`；`App.tsx` 的 `nodeTypes` 工厂少传一项。确认无其它组件依赖卡脚出片。

4. **验收策略**  
   优先扩展 `verify-shot-inspector.mjs`：断言 `.shot-vid` 数量为 0；可选用 Playwright 在「无 refImage + 有连线参考」夹具下确认视频 Tab 可点生成。若仓库无此类夹具，新增最小 `verify-shot-card.mjs` 只做 DOM 断言。

## Risks / Trade-offs

- **[肌肉记忆：卡脚出片]** → README 一句说明；不强制 toast。
- **[遗留 E2E 点击 `.shot-vid`]** → `rg shot-vid verify-` 后改走 Inspector 视频 Tab。
- **[无用 CSS]** → 可选删除 `.shot-vid*` 减少混淆。

## Migration Plan

纯前端发布；无数据迁移。回滚：恢复 `ShotNode` 卡脚按钮与 props。

## Open Questions

- 是否在首次选中「仅有参考无画面」的镜头时，用 Inspector chip 高亮「视频」——本次不做。
