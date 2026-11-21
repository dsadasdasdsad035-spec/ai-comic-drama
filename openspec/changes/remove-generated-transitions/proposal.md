# Proposal

## Why

转场曾经有两条路：零成本的 FFmpeg 效果，和「先出关键帧、再图生视频」的生成转场。生成转场最终把一条连线变成了半套视频工作台——`src/transitionGen.ts` 1292 行、`TransitionPanel.tsx` 873 行、4 个 Agent 工具、63 张食谱卡、服务端 Seedance 的 morph/keyframe 分支，全是为了让两个镜头之间多插一段两三秒的画面。它带来的成本、失效判定和提示词面板维护，都远超它解决的问题；而同类需求已经可以由「分镜之间直接连线到素材/角色」与单镜出片覆盖。

同时，画布上那条连线现在**不写任何字**：用户要看这条缝是什么转场，必须单击弹菜单。这是 2026-11-13 刻意删掉中点标签的结果（理由是中点胶囊在「关系名」与「接缝摘要」之间切换，读者无法预期）。删除生成转场把内容收敛成唯一一种之后，那个理由不再成立，可以把「这条缝是什么」直接画在线上。

## What Changes

- **BREAKING** 删除生成转场：`TransitionOut.mode` 只保留 `effect`，`transitionOut.generated` 整块退役（提示词、声音描述、成片时长、参考、首尾帧、关键帧、产物视频、原生音频、食谱、taxonomy、手改正文）。
- **BREAKING** 删除生成转场的出片链路：转场面板的生成段、`generateTransitionVideo` / `cancelTransitionVideo` / `recoverTransitionVideo`、画布上「转场参考」拖线与 `transition-pick` 菜单模式、`transitionRefAgentRefs`。
- **BREAKING** 删除服务端 Seedance 的转场模式：`/api/seedance` 不再接受 `transition` 入参，`morph` / `keyframe` / 首尾帧降级链全部移除；分镜出片、图生视频与参考模式不受影响。
- **BREAKING** 删除 Agent 转场出片工具：`attach_transition_refs`、`set_transition_audio`、`read_transition_video_inputs`、`read_transition_recipes`，以及内置动作「镜间转场决策」「转场视频提示词」。
- 删除生成转场专用模块与数据：`transitionGen.ts`、`transitionRefTools.ts`、`OutgoingReferencePickerModal.tsx`、`transitionRecipes.ts` / `.json`、`transitionSuggest.ts` 与 `POST /api/transition/suggest`、`promptRender` 中无人调用的转场渲染 bundle。
- 转场面板收缩为「接缝设置」：只保留预设选择（27 项，常用 4 项常显、其余折叠）、时长与成片 delta 一行摘要；不再有模式切换、出片预览、参考条、提示词面板与底栏生成按钮。
- 画布连线新增**接缝类型标签**：仅 `relation === 'transition'` 的连线在中点常显 `叠化 0.5s` / `擦除 → 0.6s` 这类文本；硬切、闪回、分支不显示标签。标签不可点，单击线身仍是唯一的菜单入口。
- 效果转场与成片时间模型保持不变：叠化/擦除/推移继续按 A + B − T 重叠参与预览、时间线与导出；非相邻连线标记「未参与成片」并退回硬切。
- 旧数据不迁移：`transition_out.generated` 读取时忽略、按 `effect` 渲染，写回时不再产生该字段；已有 `effect` 配置与预设 id 完整保留。

明确不做：

- 不改效果转场的时长夹紧规则、预设目录与 xfade 映射（27 项全部保留）。
- 不改统一剪辑序列 `buildEditList` 的重叠模型、字幕与配音随接缝移位的行为。
- 不删镜头首尾帧抽帧能力（`clipBoundaryFrames`），它仍被镜头首帧/尾帧素材使用。
- 不删除 `submit_joins` 与 `joins-v1` 契约，只把可写字段收窄到效果转场。
- 不提供任何替代的生成式过渡（不做图生视频接缝、不做 AI 转场）。

## Capabilities

### New Capabilities

- `shot-transition-seams`: 画布连线接缝的纯效果形态——关系与接缝语义、标记转场即默认 0.5 秒叠化、效果预设与方向、重叠时长模型、连线中点类型标签、接缝设置的唯一入口、持久化与失效边界、统一剪辑序列。

### Modified Capabilities

- `shot-transition-video-prompt`: 20 条要求整体退役（生成转场的拼装结果、首尾帧锚点、参考继承、提示词分层与手改、出片面板、blocking、输入模式降级链、时长分流、参考与尾帧互斥）。
- `shot-transition-continuity`: 3 条要求整体退役（生成转场自动正文的衔接约束与手改优先；「效果转场不受影响」随能力一并移除）。
- `shot-transition-agent`: 2 条要求整体退役（转场智能建议与建议写入 `generated`）。
- `shot-transition-effect-presets`: 「面板可选且兼容旧三型」改写——预设不再属于生成/效果模式切换，入口变为连线菜单打开的接缝设置；目录与 xfade 映射要求不变。
- `canvas-shots-workbench`: 「接缝只在画布编辑」改写入口命名，并补一条「连线显示接缝类型」。

## Impact

- **删除模块**：`src/transitionGen.ts`、`src/agent/transitionRefTools.ts`、`src/OutgoingReferencePickerModal.tsx`、`src/transitionRecipes.ts`、`src/transitionRecipes.json`、`src/transitionSuggest.ts`、`src/transitionRecipes.README.md`。
- **前端**：`types.ts`（`TransitionGenerated` / `TransitionKeyframe` / `TransitionVideo` / `TransitionBoundary` / `TransitionBridging` 删除）、`transition.ts`（`resolveJoin` 去 generated 分支、删除 `generatedFade` / `generatedClipSeconds` / `hasGeneratedVideo`）、`editList.ts`（删除插入片段分支）、`TransitionPanel.tsx` → 收缩为接缝设置、`ShotEdge.tsx`（新增中点标签）、`App.tsx`（生成/取消/恢复与转场参考拖线）、`Timeline.tsx` / `Preview.tsx`（删除转场块与 stale 提示）、`EdgeContextMenu.tsx`（「转场设置…」改称「接缝设置…」）、`BoardMenu.tsx`（批量叠化的「跳过生成」文案）、`promptRender.ts`、`api.ts`（`startVideo` 的 `transition` 入参、`ExportSegment.kind` 的 `transition`、`fetchTransitionSuggest`）。
- **Agent**：`stageTools.ts` 两个工具、`builtinPlatformTools.ts` 白名单、`skills/tools.ts`、`creative/expertToolGroups.ts`、`agent/workbenchChat.ts` 两条内置动作、`platform/projectDraft.ts` 的 joins 回执、`shotJoins.ts` / `skills/contracts.ts` 的 `generated` 字段。
- **服务端**：`server/app.ts` 的 Seedance 转场分支、`/api/transition/suggest` 路由、`assemble` 的 `kind: 'transition'` 支持（保留兼容读取，不再产生）。
- **数据**：`ShotData` / `ProjectShot` 的 `transition_out.generated` 保留可读、不再写入；无数据库结构变更、无迁移脚本。
- **规格**：本变更接管 `transition-joins`（30/30 未归档）中 `shot-transitions` delta 的效果部分；`transition-video-inputs`（21/22）、`transition-ref-agent-write`（15/16）、`shot-table-transition-joins`（15/17）三条未归档变更随之失去基础，建议一并关闭。
- **回归**：`verify-edge-menu.mjs` 的「画布上没有任何连线标签」断言反转；`verify-transitions.mjs` 保留效果侧、删除生成侧；`verify-transitions-ui.mjs` 重写；`verify-transition-folds.mjs` 大半失效；`verify-boundary-frames.mjs` 与 `verify-native-audio.mjs` 不动。
