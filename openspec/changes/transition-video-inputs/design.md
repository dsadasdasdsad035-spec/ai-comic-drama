# Design: transition-video-inputs

## Context

动机见 `proposal.md - Why`。与本次相关的现有事实（均已核对到行）：

- 分镜侧已有 `read_shot_video_inputs`（`src/agent/stageTools.ts`），投影来自 `buildShotVideoRequest`，与出片同源；转场侧没有对等工具。
- 转场出片的唯一拼装入口是 `buildTransitionVideoPreview` / `buildTransitionVideoRequest`（`src/transitionGen.ts:835` / `810`）。参考合并、`supplemental` 增删、上限截断、`styleRefs` 与尾帧互斥、请求时长都在这里面。
- 转场正文 `prompt = effectivePrompt.text`（`transitionGen.ts:1054`），来源只有 `generated.videoPromptOverride.text` 或 `generated.prompt`（`semanticTransitionVideoPrompt` 就是 `g.prompt.trim()`，`transitionGen.ts:501`）。Agent 写路径是 `submit_joins` → `generated.prompt`（`src/shotJoins.ts:105`）。
- `shotVideoInputsContext`（`stageTools.ts:79`）在宿主未提供 `shotVideoContext` 时退回 `buildShotNodes([], shots)` —— **只造分镜节点，没有素材卡节点**，于是 `asset-<canvasId>` 解析不到，被 `collectShotReferences` 静默跳过（实测：`refIds: ['char-陈默','asset-cv1']` 只回 1 条）。
- `generationContext`（`builtinPlatformTools.ts:163`）同样在无宿主时 `base = []`，有同一处缺口。
- 画布侧的节点合成已有唯一派生点 `composeShotCanvasNodes(assetNodesFromAssets(assets), shots)`（`App.tsx:1122`），但 `assetNodesFromAssets` 是 `App.tsx` 内部函数（`:369`），工具层拿不到。
- `createReadAdapter`（`builtinPlatformTools.ts:185`）没有接 `shotVideoContext`，而 `BuiltinPlatformCtx` 已具备 `getCanvasContext` / `getSelectedVideoModel` / `getVideoResolution`，接线成本为零。
- `read_asset_inventory` 的 `assets` 行 `key` 用 `url`，未暴露 `canvasId`；`read_asset_detail` 也不接受 `asset-<canvasId>`。

## Goals / Non-Goals

**Goals**

- 让 Agent 在转场上拿到与出片**同一份**输入投影：有序参考、省略项、互斥原因、模式与时长。
- 让 Pi 创意会话与画布内聊天的读取结果一致，消除「同一镜头两个答案」。
- 让 `refIds` 里的素材 token 能被反查成素材本体。

**Non-Goals**

- 不改转场拼装语义、参考上限、互斥规则、时长推导。
- 不给转场新增正文拼装或兜底：正文仍只来自 `generated.prompt` / 手改。
- 不改 `shotVideoContext` 的形状（本次只是把它接到适配器）。
- 不改分镜侧 `read_shot_video_inputs` 的返回字段（只在数据源上补齐素材卡）。

## Decisions

### D1：转场投影复用 `buildTransitionVideoPreview`，不再写第二套

工具只做「定位两个节点 → 调预览 → 投影字段」三步。参考顺序、`omitted`、`styleOmitted`、`requestSeconds` 全部原样取自预览，避免出现「工具说 3 张图、出片发 2 张」的第二套真相。

**替代方案：工具自己读 `refIds` 求和。** 否决。这正是分镜侧 `read_shot_video_inputs` 存在的理由 —— 求和推不出互斥与截断。

### D2：复用 `shotVideoContext`，不新增适配器字段

转场与分镜需要的上下文完全相同（节点 / 角色 / 缺失媒体 / 模型 / 分辨率）。新增一个 `transitionVideoContext` 只会让 `App.tsx` 和 `CreativeStudio.tsx` 各多写一份，且将来必有一处忘记同步。

### D3：无宿主的退化路径改为「分镜节点 + 素材卡节点」

把 `assetNodesFromAssets` 从 `App.tsx` 提到 `canvasShots.ts` 导出，退化为：

```ts
composeShotCanvasNodes(assetNodesFromAssets(project.assets ?? []), project.shots ?? [])
```

`composeShotCanvasNodes` 已保留素材卡并复用分镜节点，是现有唯一派生点，不需要新写合成逻辑。`generationContext` 与 `shotVideoInputsContext` 共用这一处。

**为什么必须做：** 现在 Pi 路径下 `read_shot_video_inputs` 会**少报**参考（静默），Agent 照着写出的 `[图N]` 映射与画布出片不符 —— 直接违反 `shot-video-prompt` 的「参考顺序与出片请求一致」。这是 bug，不是体验问题。

### D4：`read_asset_detail` 接受 `asset-<canvasId>` 别名

`assets` 分类的 `key` 归一化规则：去掉前缀 `asset-` 后按 `canvasId` 命中；命中不到再按原样匹配 inventory 的 `key`（`url`）。别名不改变任何已有调用：原 `key` 仍可用。`read_asset_inventory` 的 `assets` 行增加 `canvasId` 字段，让 Agent 知道该用什么。

### D5：工具不返回正文

正文读法已有两条明确路径（`read_shot_detail` 的 `transition_out.generated.prompt`、手改快照）。再让输入工具回正文，会让「输入」与「内容」混在一个响应里，Agent 容易把输入清单当成可直接改写的正文模板 —— 与 `shot-prompt-agent-authored` 刚确立的「正文由 Agent 写」相反。工具只回 `promptSource` / `promptStale` / `promptEmpty`，让 Agent 自己判断要不要补写。

## Risks / Trade-offs

- **`buildTransitionVideoPreview` 变热**：每个转场读一次会重算参考合并。单次是纯函数、数据量在镜头级别，可接受；不做缓存，避免指纹失效问题。
- **提到 `canvasShots.ts` 的 `assetNodesFromAssets` 与 `App.tsx` 存量调用**：必须保持同一顺序（按 `assets` 下标落位），否则素材卡首次进画布会换位置。迁移时只搬函数不动实现，`App.tsx` 改为 import。
- **工具返回体积**：参考与省略项在极端情况下可能很长，沿用 `boundJson` 的既有上限处理。
