# Design

## Context

- 现状（见 `proposal.md - Why`）：`transitionBoundaryCandidates` 给每槽列上/下镜画面、候选图、抽取帧、refExtras；用户点候选后 `setBoundaryUrl` 写库。抽取与选择是两步。
- `ensureTransitionBoundary`（`src/transitionGen.ts`）在有成片时抽视频帧，没有成片时回退 `currentShotImage`（静帧）。这个回退是当前「静帧也能当首尾帧」的来源。
- 上一个变更留下 `BoundarySource` 六值枚举与 `boundarySourceLabel`，标签已与来源绑定。

## Goals / Non-Goals

**Goals:**

- 唯一来源：首帧 = 上镜成片尾帧，尾帧 = 下镜成片首帧。
- 抽一次即写入两侧，去掉二次点选。
- 没有成片时不静默降级为静帧。

**Non-Goals:**

- 不改 `first_frame` / `last_frame` 的服务端提交协议。
- 不改旧项目已存的边界值，也不迁移其来源字段。
- 不删除 `ensureTransitionBoundary` 的抽帧实现，只删除静帧回退与 multi-candidate 包装。

## Decisions

### 1. 抽取即写入，不再经过候选状态

**决策：** `TransitionPanel` 的「抽取两镜成片帧」直接调用 `ensureTransitionBoundary`，把返回的两帧一次性 `setGenerated({ boundary })` 写入，并带上 `outFrom: 'source-tail'`、`inFrom: 'target-head'`。删除 `extractedBoundary` 本地状态与 `transitionBoundaryCandidates`。

**备选：** 保留候选状态，只是候选池缩成两项。否决：两项候选且必须两边同时成立，等于没有选择余地，徒增一步点击。

### 2. 静帧回退删除而不是加开关

**决策：** `ensureTransitionBoundary` 去掉 `if (!out) out = currentShotImage(...)` 两条回退，缺画面时返回空并附 warning。这样「没有成片」会成为 blocking，而不是悄悄用静帧。

**备选：** 保留回退但标 `source-frame`。否决：静帧不是用户要的第一帧/最后一帧，用它会让转场两端对不上成片实际画面。

### 3. 弹窗首尾帧页只保留预览与动作

**决策：** 槽位保留（显示已选缩略图、来源标签、单侧清除），删除候选网格、媒体库按钮、手填输入框、`BoundarySlotCandidate` 类型与 `.orp-cand*` 样式。

**备选：** 保留媒体库/手填作为兜底。否决：`首尾帧` 的语义是两镜成片的接缝画面，外部图片在结构上不是同一个东西。

### 4. 单侧失败保留原值

**决策：** `ensureTransitionBoundary` 返回的 boundary 中，某侧失败则该侧字段为 `undefined`。写库时用「新值 ?? 旧值」合并，避免一次失败清空另一侧的成功结果。

**备选：** 整体覆盖。否决：会造成「抽了一次，成功的一侧也被清掉」的困惑。

## Risks / Trade-offs

- **[Risk] 没有成片的镜无法生成转场** → 这是有意的：blocking 明确要求先为该镜出成片；文案带「打开上镜/下镜」入口。
- **[Risk] 旧项目媒体库来源边界仍能生成** → 允许，避免破坏已出片项目；再次抽取会替换为成片帧。
- **[Risk] 用户想用静帧做首帧** → 先给该镜出成片；静帧本身不是「最后一帧」。
- **[Risk] 抽帧耗时** → 只在用户点击时执行，且已有 `frameCache` 按 URL 缓存。

## Migration Plan

- 无数据迁移。旧 `boundary` 原样读取；`outFrom/inFrom` 非两个新值的旧记录继续按原标签展示。
- 回滚：恢复 `ensureTransitionBoundary` 的静帧回退与候选函数即可。
