# Design

## Context

- 分镜：`VideoPromptPanel` + `Inspector` `si-foot`（`Inspector.tsx`）。
- 转场：`TransitionPanel` 内嵌生成按钮；`videoPromptOverride` 为裸 `string`，无 fingerprint stale。
- 转场成片 stale 已有 `transitionOut.meta.fingerprint` vs 当前指纹（整段出片条件）。
- 主规格：`shot-transition-video-prompt` 已要求预览=请求与风格参考编辑。

动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- `TransitionPanel` 增加 `footer.tr-foot`（或复用 `si-foot` class）承载 primary CTA，从「生成转场」field 中移出原按钮行。
- 最终正文区复制 `VideoPromptPanel` 状态机：`open` 已有；新增 `editing` + `draft` + save/restore。
- Override 快照：优先将 `TransitionGenerated.videoPromptOverride` 改为 `VideoPromptOverride | undefined`（与 `ShotData` 同型），`normalizeGenerated` 兼容旧 string。
- Stale badge：`effectiveTransitionVideoPrompt` 或面板内 helper 对比 `override.fingerprint` 与 `buildTransitionVideoRequest(...).promptFingerprint`（新建短 hash：边界+refs+分层字段，不含 override 自身）。
- 分区重排：移动边界缩略图编辑紧跟结构锚点列表后；生成按钮仅留底栏。

**Non-Goals:**

- 抽出共享 `VideoPromptPanel` 组件（二期）。
- 边选中时替换 Inspector 布局。
- 转场 `videoMeta` 历史 prompt 折叠（可 follow-up）。

## Decisions

### 1. Override 类型

**决策：** `TransitionGenerated.videoPromptOverride` 升级为 `VideoPromptOverride`；读取时 `typeof === 'string'` 迁移为 `{ text, fingerprint: '', createdAt: iso }` 且不标 stale。

**备选：** 新字段 `videoPromptOverrideSnap` — 持久化双字段，拒绝。

### 2. 拼装指纹（手改用）

**决策：** `transitionVideoPromptFingerprint(source, target, generated, styleTokens)` JSON hash，字段对齐现有 `transitionFingerprint` 中与 prompt 相关的子集（boundary、prompt、sound、refs tokens、bridging），**不含** override 与成片 meta。

**备选：** 复用整段 `transitionFingerprint` — 含 effect/邻镜 size，手改后误报多，不用。

### 3. Footer 样式

**决策：** 转场面板根节点加 `tr-panel--foot`，结构：

```text
aside.tr-panel
  header ...
  .tr-panel-body (scroll)
  footer.si-foot (sticky)
```

复用 `si-foot` / `si-foot-note` 减少 CSS。

### 4. 跳转相邻镜

**决策：** `TransitionPanel` 新 prop `onFocusShot: (nodeId: string, tab?: 'video') => void`；App 设 `setSelNode` + `setInspectorTab('video')`。

**备选：** 仅 toast 提示镜号 — 体验差，不用。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 旧项目 string override | normalize 迁移 |
| 双 stale（成片 meta vs 手改 badge）| 文案区分：成片「出片条件已变」；手改「旧快照」 |
| 面板变长 | body 区域 scroll，foot sticky |

## Migration Plan

- `normalizeGenerated` / `shotSync` 读写兼容 string override。
- 无服务端变更。

## Open Questions

- 是否在转场 foot 同时展示「重叠时长」delta（已在 `tr-foot`）— 保留现有 `tr-foot` 统计，与 `si-foot` 叠放或合并为一行。
