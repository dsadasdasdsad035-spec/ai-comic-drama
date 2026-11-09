# Design

## Context

见 `proposal.md`。分镜参考：`shot.refIds` + 派生边 `ref-{rid}-{shotId}`。转场已实现雏形：`generated.refIds`、`ref-tr|{edgeId}|{refSourceId}`、`toggleTransitionRef`，依赖 `selEdgeId` 区分转场连线和分镜连线。

## Goals / Non-Goals

**Goals:**

- 画布交互与分镜参考同构（拖线、右键勾选、派生边、Delete 删除）。
- 数据只进 `generated.refIds`，不进 `shot.refIds`。
- 与 `mergedTransitionShotReferences` / `transitionFingerprint` 一致（refIds 已在指纹中）。

**Non-Goals:**

- 转场边中点独立节点（当前用上镜节点作视觉 anchor）。
- 无选中边时自动猜转场目标。
- 视频/音频素材作为转场 reference_image（仍遵循现有素材类型过滤）。

## Decisions

### 1. 边 ID 与解析

`ref-tr|{edgeId}|{refSourceId}`，`|` 分隔（edgeId 形如 `seq-{src}-{tgt}`）。解析用于删除与 `selRef` 命中。

### 2. onConnect 门闩

仅当 `selEdgeId` 指向 `relation=transition` 的边，且 target 为该边的 source 或 target 镜头、source 为 char/asset 时，写入转场 ref。否则 char/asset→shot 走原 `patch refIds`。

### 3. 派生边渲染

`refEdges` 在分镜 ref 之后追加：source=素材/角色 id，target=转场 **上镜** id（与分镜 ref 相同 target 类型，靠 label「转场参考」+ 虚线区分）。

### 4. 右键菜单

`ctxData.mode === 'transition-pick'` 当 `selEdgeId` + char/asset 右键；`items` 为 `refCards`，`on` 状态读 `generated.refIds`。

### 5. 模式检查

`mode !== 'generated'` 时拖线：toast 提示，不写入（避免效果转场误写 refIds）。

## Risks / Trade-offs

- **[Risk] 用户忘记先点转场边** → 面板与高级区文案说明；可选后续：转场面板打开时自动 `setSelEdgeId`（已有点边打开面板）。
- **[Risk] 视觉上连到上镜易误解为镜头参考** → 标签「转场参考」+ 虚线；spec 明确不进 shot.refIds.
- **[Risk] 与 inherit 重复 URL** → merge 按 URL 去重；画布 token 与继承同源时列表一条。

## Migration Plan

无数据迁移。旧项目无 `generated.refIds` 为空数组即可。

## Open Questions

- 是否在打开 `TransitionPanel` 时强制保持 `selEdgeId`（避免连错分镜）——当前依赖用户点边；可在 apply 阶段评估。
