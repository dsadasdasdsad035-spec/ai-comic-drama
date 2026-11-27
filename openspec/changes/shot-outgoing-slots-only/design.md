# Design

## Context

动机见 `proposal.md`。这里只记录影响实现的现状约束。

**请求通路现状**：`buildShotVideoRequest`（`src/videoPrompt.ts`）是预览与实际请求的唯一拼装入口；`generateVideoOne`（`src/App.tsx:3340`）与 agent 的 `generate_clip`（`src/agent/builtinPlatformTools.ts:750`）都消费它。附件分三类字段：`refs[]`（图片）、`video`（单条）、`audio`（单条）。

**服务端不读 `audioMode`**：`server/app.ts:7890` 只读 `generateAudio` 与 `audioRef`，`:8154` 的 `mode = generateAudio ? 'native' : ...` 是服务端自己推导的。客户端 `audioMode` 仅用于决定是否发 `generateAudio`。

**时长求解**：Seedance 2.5 的模型下限本来就是 4 秒（`videoSeconds.ts:30`），原生音频下限也是 4 秒，两者相等。因此原生音轨开关对请求秒数与成本零影响，`native-audio` 这个 floor kind 在 2.5 上是死分支。

**音频素材目前进不了参考**：`shotReferences.ts:282` 与 `:355` 对非图片/非视频素材直接 `continue`；`MediaPicker` 已支持 `accept: ['audio']`，`resolveApimartAudioRef`（`server/app.ts:2343`）已支持本地文件（2–30 秒、15MB）与远程 URL。

**零引用组件**：`LipSyncPanel.tsx`、`VideoReferenceList`、`VideoReferenceSummary`、`TransitionNativeAudioBlock` 全仓库无人 import，可直接删除。

**台词的唯一编辑入口在 Inspector 音画页**：卡面只读显示，`Timeline` 只读。Agent 侧 `submit_shots`（`shots-v1`）可按镜号增量写入 `dialogue` / `performance` / `delivery`。

## Goals / Non-Goals

**Goals**

- 出片镜 Inspector 变成单一滚动区的四槽位面板，槽位条目即请求附件。
- 音频槽位成为真实可选槽位，补齐音频素材通路。
- 原生音轨从「逐镜开关」变成「能力声明驱动的常量」。
- 删掉所有不进请求的展示区块与死码。

**Non-Goals**

- 不改服务端协议、不改 `buildApimartVideoPayload` 字段集。
- 不改 `ratio` / `vidRes` / `candCount` 等全局出图表单的归属（`ratio` 仍是 App 全局 state）。
- 不实现 `canvas-prod-modes-no-voice` 的出图/出片模式切换与连播音轨 R2 规则（见 Migration Plan 的取舍）。
- 不迁移存量数据，不改变字段序列化格式。

## Decisions

### D1：槽位是视图层派生，不是新的数据模型

`ShotData` 不新增 `slots` 字段。四个槽位的条目全部由现有字段派生：

```
图片槽位  <- collectShotReferences(refIds) + refExtras + 表情单格
视频槽位  <- collectVideoReferences(refIds) + resolveMotionLexiconVideoRef
音频槽位  <- audioRef（若已保存）或 nativeAudioRef 的自动推断结果
提示词    <- videoPrompt / videoPromptOverride
```

理由：附件本来就由连线与开关决定，加一层持久化槽位会出现「槽位与连线不一致」的第二事实源，正是 `shot-video-prompt` 的「实际附件与提示词正文分离」要避免的。替代方案是新增 `shot.slots` 结构，被否决——它会让画布连线与槽位双写，且要写迁移。

### D2：音频槽位复用 `audioRef`，扩展 `source`

`AudioRef` 当前是 `{ character: string; url: string; label?: string }`。改为：

```ts
type AudioRef = {
  url: string
  label?: string
  /** 角色名；手选素材或手工地址时为空 */
  character?: string
  source: 'character' | 'asset' | 'manual'
}
```

`source` 用于槽位显示来源标签，不参与请求。`character` 从必填变可选是必要改动：手选素材库音频时没有角色。

**解析优先级**（在 `buildShotVideoRequest` 内一处判定）：

```
槽位有显式 audioRef  -> 用它
槽位为空             -> nativeAudioRef 自动推断（台词说话人 -> 角色音色样本）
推断不可用            -> 只发 generate_audio，不带 audio_url
```

理由：自动推断是存量行为，且是「台词说了谁就用谁音色」这一产品直觉的载体；显式选择是覆盖。替代方案是彻底删除自动推断、只认显式槽位，被否决——它会让所有存量镜头突然失去音色参考。

### D3：`audioMode` 停止参与出片判断

`generateAudio` 改为 `Boolean(audioCaps?.supported)`。`audioMode` 字段保留在类型与序列化中，仅用于兼容存量数据读取（`shotSync.ts:369` 的水合），不再有任何出片分支依赖它。

`videoPrompt.ts` 里随之删除：

- `nativeBlocked` / `nativeDegraded` / `nativeNoReference` 三个分支
- `mode` 的 `native` 特判（保留 `first` / `ref` / `video` 三值，供非 2.5 模型与显示）
- `native-degraded` / `native-no-reference` 两条 warning

理由：需求要求「程序不逐镜判断要不要带音轨」。保留这些分支会让同一条产品规则存在两种实现路径，后续必然漂移。

### D4：删除 `no-image` 与 `native-no-image` 两条闸门

`videoPrompt.ts:476` 的 `if (!nativeMode && refs.length === 0 && !firstFrame && !primaryVideo)` 改为无条件删除（不再有 `nativeMode` 概念，而需求允许纯文本出片）。`native-no-image` 的 warning 保留但改为不依赖 `nativeMode` 的「无参考」提示。

唯一保留的阻断：`shot-prompt-empty`，以及槽位条目媒体失效（`video-asset-missing` / `neighbor-missing`）。

理由：需求「有提示词就能出」。纯文本出片对 Seedance 2.5 合法（`features.textToVideo`），对不声明该能力的模型仍由 warning 提示可能被拒。

### D5：`Inspector.tsx` 重排为槽位面板，而非新建组件树

在 `Inspector.tsx` 内把 `InspectorBody` 的出片分支重写为四段，而不是拆成新的 `ShotSlotsPanel.tsx`。理由：`InspectorBody` 已持有 `patch`、`videoRequest`、`settings`、`pick`、`characters` 等全部所需上下文，抽出组件会把 20+ props 转手一次；且现有 `AssetPanel` 也走同一文件，风格一致。

但槽位条目的**渲染**抽成模块内小组件（`ImageSlot` / `VideoSlot` / `AudioSlot` / `PromptSlot`），避免单个函数继续膨胀。

`OutgoingVideoPromptPanel.tsx` 从「提示词面板」退化为「提示词槽位」，保留 Fold 折叠与徽章逻辑，删除 `submitTarget`、`summary`、`refs` 清单、`omitted` 清单等区块——这些信息已由三个槽位组件承担。

### D6：音频素材经 `collectAudioReferences` 进入槽位

新增纯函数，与 `collectVideoReferences` 同构：

```
输入：refIds、nodes、missingMedia
规则：只取 assetMediaType === 'audio' 的素材卡
输出：{ refs: [{ url, label, token }], missing: [...] }
首期只取第一条，其余列被忽略
```

理由：现有 `collectShotReferences` 与 `collectVideoReferences` 都按媒体类型分流，音频复用同一模式最省事；`MediaPicker` 的 `accept` 参数已支持音频。

### D7：`inspectorLayout.ts` 收缩

`ShotInspectorTab` 从 5 值降到 4 值（删 `audio` / `meta`）；出片镜只 `outgoing`，生图镜只 `visual` / `narrative`。

`CollapsibleSection` 删 `performance` / `schedule` / `motionPrompt` / `advanced` / `videoSettings`，保留 `shotParams`（生图镜用）/ `refs`。

`shotStatusChips` 整函数删除（对应 spec 的「工位徽章与过滤状态 chip」移除）。

**偏好兼容**：`loadInspectorPrefs` 的 `migrateTabPref` 需把存量 `audio` / `meta` 映射到 `outgoing`，`more` 也映射到 `outgoing`，否则老用户读到非法 tab 会落到默认值而跳页。

理由：localStorage key 仍是 `storyboard-inspector-v1`，不做版本升级的话必须做值映射。

### D8：删组件，留逻辑

删除：`NativeAudioPanel.tsx`、`CaptionPanel.tsx`、`NarrationPanel.tsx`、`PerformanceEditor.tsx`、`LipSyncPanel.tsx`。

保留：`captions.ts`（Preview 烧字幕、导出 cue 仍需要）、`narration.ts`（agent `generate_narration` 工具仍用）、`performance.ts`（指纹与序列化）、`nativeAudio.ts`（`nativeAudioRef` 自动推断仍用，只删胶水）。

理由：删的是画布 Inspector 的入口，不是能力。字幕与旁白仍有 Preview/导出与 agent 路径消费。

## Risks / Trade-offs

**[台词再无人工入口，错别字只能改对话]** → 已在提案中作为 BREAKING 明确。缓解：`submit_shots` 支持按镜号增量写入，创意会话可直接改；存量字段不动，任何外部编辑项目 JSON 的方式仍然有效。

**[`camera_fixed` 失去唯一触发点]** → `move === '固定'` 是 `camera_fixed: true` 的唯一来源。缓解：`generateVideoOne` 与 `generate_clip` 的 `cameraFixed` 表达式保留（读 `node.data.move`），只是界面不再提供修改 `move` 的控件；Agent 与导入仍可写 `move`。

**[原生音轨恒开后，非 2.5 模型行为变化]** → 只有 `audioCaps?.supported` 为真才发 `generateAudio`，非 2.5 仍为 `false`，服务端 `:8000` 的 400 分支不会被触发。需在实现时保证判定用 `audioCaps` 而非 `audioMode`。

**[纯文本出片可能被部分模型拒绝]** → `features.textToVideo === false` 的模型仍给出 warning，不阻断。属于上游能力差异，非本次改动引入。

**[4 个验收脚本大面积失效]** → `verify-native-audio-ui.mjs` 整份语义消失（要驱动的 checkbox 不存在了），必须重写为「音频槽位选择 + generate_audio 恒真」断言。其余三个只需改选择器。

**[与 `canvas-prod-modes-no-voice` 的条款冲突]** → 该变更同样修改 `shot-inspector-layout` 且要求「台词与表演在更多页编辑」。两者若都 apply 会互相覆盖。见 Migration Plan。

**[`AudioRef.character` 由必填变可选]** → 所有读 `audioRef.character` 的位置（`nativeAudioFingerprint`、`App.tsx:3451`）需处理空值。缓解：指纹里用 `?? ''`；`audioRef` 落库时的 `character` 缺失即表示来源非角色。

## Migration Plan

**实施顺序**（避免中间态无法编译）：

1. 数据与纯函数层：`AudioRef` 扩字段、`collectAudioReferences`、`buildShotVideoRequest` 改成槽位口径（此时 Inspector 尚未改，旧界面仍能跑）。
2. `inspectorLayout.ts` 收缩 + 偏好值映射。
3. `Inspector.tsx` 重排为四槽位 + 删除音画/元数据页。
4. 删除死码组件与不再引用的 import。
5. 验收脚本改写。

**与 `canvas-prod-modes-no-voice` 的取舍**：本变更优先。该变更尚未实现（0/12），其 spec delta 中有三条与本变更正面冲突：

- `canvas-prod-mode` 的「Inspector Tab 随模式显隐」：要求出片模式显示 `视频` + `更多`
- `canvas-prod-mode` 的「台词与表演在更多页编辑」
- `canvas-prod-mode` 的「出图工位在 Inspector 画面 Tab」（不受影响，保留）

处理：apply 本变更时**不修改**该变更目录；在 `tasks.md` 里列为「需人工决定」的后续项。若用户后续要推进该变更，须先在 `/opsx:update-change` 中删除上述两条 requirement，再 apply。理由是它属于另一个变更的既定范围，本变更不应越界改写。

**无数据迁移**：`audioMode` 保留为只读兼容字段；`audioRef.character` 变可选对存量数据天然兼容（存量都有值）。存量 `audioMode: 'off'` 的镜头会在下次出片时自动带原生音轨——这是需求要的行为，但属于用户可感知的变化，需在发布说明中写明。

**回滚**：`audioMode` 字段未被删除，重新引入逐镜开关只需恢复 `NativeAudioPanel` 与 `generateAudio = audioMode === 'native'` 一行判定。槽位视图与连线数据无耦合，回滚 Inspector 不影响已保存的项目文件。

## Open Questions

无。所有影响 specs 与任务拆分的决定已在上文与提案中确定。
