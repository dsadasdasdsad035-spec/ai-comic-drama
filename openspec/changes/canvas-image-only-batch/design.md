# Design

## Context

见 `proposal.md`。`canvas-image-only-card` 已移除卡脚单镜出片；`App.tsx` 的 `selbar` 仍有 `出图|出片|配音`，`BoardMenu` 仍有「批量出片/配音」。`runOnSelected` 与 `generateVideoAll` / `voiceAll` 实现可复用于 Inspector，无需删服务端逻辑。

## Goals / Non-Goals

**Goals:**

- UI 上从画布移除批量出片、批量配音及 selbar 单批出片/配音按钮。
- 收窄 `BoardMenu` props：`onGenVideoAll`、`onVoiceAll`、`vidBatch`、`vbatch` 可从组件接口移除；`App` 保留 `generateVideoAll` / `voiceAll` 若 Inspector 或其它入口未使用则可留作死代码清理项（tasks 中 optional）。
- 更新 README 与 Playwright（含 `verify-voice.mjs` 批量配音路径）。

**Non-Goals:**

- 卡面视频预览、Inspector 四 Tab、连播/导出音轨、任务中心对已存在 voice/video task 类型的展示逻辑（历史任务可读即可）。

## Decisions

1. **删 UI 不删生成函数**  
   `generateVideoOne` / `generateVoiceOne` 继续服务 Inspector；`runOnSelected` 可只接受 `'image'` 或保留内部 `'video'|'voice'` 分支但不暴露按钮（倾向删除分支减少误触，tasks 实现时二选一并在 tasks 写明）。

2. **BoardMenu 进度文案**  
   `progText` 仅反映 `batch`（画面）；`vidBatch`/`vbatch` 从 props 删除后触发器不再显示「出片中/配音中」——批量视频/配音若仍在跑（旧会话）由任务中心承担，本次不单独做迁移 UI。

3. **与上一 change 归档顺序**  
   先归档 `canvas-image-only-card` 将 `storyboard-shot-card` 落入主 spec，再归档本 change 用 MODIFIED/REMOVED 合并；开发时可 sequential apply。

## Risks / Trade-offs

- **[批量出片工作流断裂]** → README 明确逐镜 Inspector；后续可在镜头表/时间线另开 change。  
- **[verify-voice.mjs 依赖批量菜单]** → 改为 Inspector 单镜或拆成 voice API 单测。

## Migration Plan

纯前端；回滚即恢复菜单项与 selbar 按钮。
