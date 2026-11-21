# Design

## Context

见 `proposal.md`。现状要点：

- `POST /api/frames` + `transitionGen.videoFrames` 已能抽首/尾帧；转场写入 `generated.boundary` 临时 jpg。
- 素材卡经 `newAssetCard` → `assetsPayloadOf` → `patchProject({ assets })`；`refIds` 使用 `asset-<canvasId>`。
- `shot-prev` 解析 `currentShotImage`，不读成片尾帧。

## Goals / Non-Goals

**Goals:**

- 分镜侧复用同一抽帧语义（含近黑 `notices`）。
- 溯源幂等：`sourceShotId` + `frameRole` 覆盖更新，保留 `canvasId`。
- Inspector 三按钮 + 写 `refIds` 的一键上一镜尾帧。

**Non-Goals:**

- 不扩展 `shot-prev` / `shot-next`。
- 不自动在出片成功时建卡（无默认自动尾帧卡）。
- 不改变转场 boundary 存储；不强制转场与素材卡 URL 去重（可后续迭代）。
- 出片成功不自动给下一镜加 `refIds`。

## Decisions

### 1. 共享抽帧：`clipBoundaryFrames(url)`

从 `transitionGen.ts` 抽出 `videoFrames`（或重命名为 `clipBoundaryFrames`）到 `src/clipBoundaryFrames.ts`，`ensureTransitionBoundary` 与分镜发布共用，缓存键仍为成片 URL。

*替代：分镜直接调 `extractFrames`*——会复制近黑与尾帧缓存逻辑。

### 2. 数据模型：`ProjectAsset` 可选字段

```ts
sourceShotId?: string   // 如 E01-S01
frameRole?: 'head' | 'tail'
sourceClipFingerprint?: string  // localPath(clip) 或 videoMeta 指纹
```

发布时 `find`：`assets.find(a => a.sourceShotId === id && a.frameRole === role)`。

- 命中且画布仍有节点 → 更新 `url`、指纹、`title`；`patchProject` + 更新内存节点 `data.url`。
- 命中但画布无节点 → 按删卡重建：新 `canvasId` 或复用逻辑与设定卡「删除后重建」对齐。
- 未命中 → `newAssetCard`。

*替代：仅存 tags 字符串*——无法稳定幂等，拒绝。

### 3. 成片指纹

优先用 `shot.clip` 规范化路径；若无则用 `videoUrl`（画布节点）。指纹字符串用现有 `shortHash` 或 clip 路径字面量；不匹配时覆盖仍允许（用户显式重抽）。

### 4. 「引用上一镜尾帧」流程

1. `neighborShots` 取 `prev`；无则 toast 错误。
2. 读 `prev.data.videoUrl`；无则错误。
3. `upsertClipFrameAsset(prevShotId, 'tail', url)` → 返回 `canvasId`。
4. `assetNodeId(canvasId)` 若不在本镜 `refIds` 则 append；`patchProject` shots + 画布边（若产品要自动连线：创建 `ref` 边，与手动拖线同 id 规则——**P0 仅 refIds，连线可选 P1**）。

设计默认 **P0 只写 refIds**（规格已要求 refIds；自动画线放 tasks 可选）。

### 5. Inspector 入口

成片 `<video>` 区块下按钮组；与生图镜成片预览共用（`videoUrl` 存在即可）。近黑提示用 `gen-note` 类，与 `TransitionPanel` 一致。

### 6. Agent（可选任务）

`publish_shot_clip_frame({ no, role: head|tail })`  
`link_prev_shot_tail_frame({ no })`  
实现与 Inspector 调用同一 `upsertClipFrameAsset` 纯函数。

## Risks / Trade-offs

- **[Risk] refIds 有 token 但画布未加载该集素材节点** → 解析 missing；缓解：发布时确保节点在本集画布或下次打开 `assetNodesFromAssets` 全量加载 assets。
- **[Risk] 大量 sched jpg** → 与转场相同；旧图不自动删，靠媒体 GC 策略（若尚无则文档注明）。
- **[Trade-off] 不自动连线** → 用户需在画布看见卡；refIds-only 对 Agent/出片仍有效。

## Migration Plan

- 无 schema 迁移：新字段可选；旧项目无溯源卡行为不变。
- 部署：前后端同发；仅前端也可工作（类型扩展）。

## Open Questions

- 是否在 P1 为「引用上一镜尾帧」自动画参考边（当前设计 refIds-only）。
- 转场抽取时是否 later 复用同源卡 URL（非本变更）。