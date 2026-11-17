# Design

## Context

现状（见 proposal.md - Why）：

- 转场参考只来自 `generated.refIds`：`normalizeGenerated` 恒设 `inheritRefs: false`，`effectiveTransitionRefs` 只按 `refIds` 取候选。
- 候选池 `transitionRefCandidates()` 已实现且被面板弹窗使用，但没有任何工具暴露它。
- `submit_joins` 的 `generated` 只认 6 个字段，`passthrough` 使多余键不报错；`applyJoins` 只读这 6 个键，其余丢弃。
- 原生音频链路完整（`audioMode`/`audioRef`/`audioMeta` → `audio_url`），但开启入口只有 `TransitionNativeAudioBlock`。
- `voiceSample` 只在角色卡 UI 生成，Agent 无工具；APIMart 音频能力：单个 `audio_url`、单说话人、`minVideoSeconds: 4`。
- `read_transition_video_inputs` 已在 `transition-video-inputs` 中落地（按接缝投影 `refs`/`styleRefs`/`audio`），本变更在其上做增量。

约束：

- 候选池包含**整张角色表**的外观图，不是只含连线参考；单次写入必须可解释、可回溯。
- token 是内部约定（`char-<id>`、`asset-<canvasId>`、`extra:<url>`），`char-miss*` 占位令牌永远不可选。

## Goals / Non-Goals

**Goals:**

- Agent 一次读取就能同时知道"能选什么"（候选池）与"已经选了什么"（有序 `[图N]`）。
- Agent 用名字添加/移除参考、开关原生音频，且所有失败都有可执行文案、不写脏数据。
- 出片区在不展开折叠时也能核对本次提交了哪些素材图。

**Non-Goals:**

- 不扩 `submit_joins` 契约（参考与音频走独立工具）。
- 不做音频素材卡作为转场参考音频（单 `audio_url` 与角色音色二选一）。
- 不让 Agent 生成 `voiceSample`，也不恢复 `inheritRefs`。
- 不让 Agent 写 `boundary` 首尾帧（仍需抽帧工具或 UI）。
- 不改参考图张数上限（当前为不限）。

## Decisions

### 1. 参考写入用独立工具，不扩 `submit_joins`

新增 `attach_transition_refs`。理由：`generated` 是 `passthrough`，多传键会被静默丢弃，写入成功与否无法从返回判断；而参考是集合语义（add/remove + 幂等），与 `link_shot_refs` 同构。

备选：`generated.refs: { add: [], remove: [] }` —— 契约变胖、与提示词写入耦合、错误信息只能塞进 `issues`，被否。

### 2. 名字寻址，token 在工具内部解析

调用方给角色名 / 素材卡标题 / URL，工具用与 `link_shot_refs` 相同的 `resolveRefTargets` 思路解析成 token；同名歧义、找不到、占位角色一律 `ok: false` 并列出候选。理由：`asset-<canvasId>` 让模型手拼必然出现幻觉 id，且失败无法解释。

URL 只接受"候选池里已存在的 url"，命中后回退到该候选的 token（含 `extra:<url>`）；池外 URL 直接拒绝并给出"先在画布上加为手工参考"的指引，避免 Agent 引入无法核对的地址。

### 3. 候选投影挂在既有读取工具上

`read_transition_video_inputs` 增 `candidates[]`、`audio.caps`、`audio.sample`、`summary`。理由：候选与已提交必须**同一次读取**取自同一份预览计算，否则两次调用之间用户改了画布，模型就会按过期的候选写 `[图N]`。

`candidates[].submitted` 由 `effectiveTransitionRefs` 的 token 集合求交得出；`summary` 在 `refs` 为空时也必须给出，避免模型把"没提交"误读成"没素材"。

### 4. 音频只接受 `mode` + `character`

`set_transition_audio({ mode, character? })`，音色由系统从 `voiceSample` 解析。理由：模型传 URL 既不可信也无法校验；角色名是项目内稳定标识。

门禁**复用** `audioRefCapabilitiesFor` + `nativeAudioRef`（用 `nativeAudio: true` 试算 `requestSeconds`），不另写一套判断。`audio_fingerprint` 用 `nativeAudioFingerprint({ modelKey, audioRef, dialogue })`，`dialogue` 取 `transitionDialogueText(source, target)` 解析结果，与出片一致。

失败分三类文案：模型不支持 / 角色无可用样本（指向角色卡）/ 台词多说话人或缺失（指向拆镜或关音频）。关闭时同时清 `audioRef` 与 `audioMeta`。

### 5. 出片区展示复用现有附件结构

`VideoAttachment` 已带 `url` 与 `source`，`TransitionRef.source` 的 `character`/`asset`/`extra` 直接映射为来源标签。缩略图与标签只需在 `OutgoingVideoPromptPanel` 的 `vp-refs` 与转场出片区渲染层补元素，不需要新增投影字段。

「Agent 写入」标记用**内存**回调：工具执行成功后 `onTransitionRefsWritten(edgeId, tokens)` 写入 App 级 `Map`，刷新页面即消失。理由：标记语义是"本轮 Agent 改的"，落盘会把历史来源永久固化，且用户手动增删后无法撤销该标记。

### 6. Agent 写入不追加 `handEdited`

`handEdited` 记录"人改过"，由 UI 与 `applyJoins` 维护；Agent 写 `refIds`/`audioMode` 只改业务字段。理由：`mergeGenerated` 以 `handEdited` 为准保留旧值，Agent 自行标脏会让后续模型重生成被静默冻结。工具返回值里明确"本次写入的参考/音频"，不借 `handEdited` 表达。

## Risks / Trade-offs

- [转场台词来自两镜合并，多说话人频繁] → 保持单说话人拒绝，文案给出"拆单人镜 / 关闭音频"两条出路；`audio.caps` 与 `sample` 让 Agent 在写入前就能预判。
- [原生音频把请求抬到 ≥5s，再裁回目标时长，成本上升] → `set_transition_audio` 返回值带 `requestSeconds` 与 `trimTo`，提示词面板同步显示，避免静默抬价。
- [候选池含整张角色表，Agent 可能一次塞十几张] → `attach_transition_refs` 单次 `names` 上限 8，超出返回 `omitted` 与原因；投影里的 `summary` 也提示总数。
- [Agent 写的参考顺序被模型误读成 `[图N]`] → 写入工具返回写入后的有序 `refs`（含 `index`），读取工具再投影一次；两处同源同序。
- [内存 Agent 标记丢失] → 明确它是"本轮"标记；核对主要依据仍是来源标签与缩略图。
- [与 `transition-video-inputs` 的投影字段重叠] → 本变更只 ADDED 新字段与新 requirement，不改动该变更已写的字段语义；两者可独立落地，但建议先归档前者。

## Migration Plan

- 存档兼容：旧 `generated.inheritRefs`/`excludeRefIds` 不迁移、不报错，读取时按现有 `normalizeGenerated` 忽略。
- 新工具可由 `expertToolGroups` 开关关闭；关闭后 Agent 调用按既有授权规则被拒。
- 回滚：删除两个工具的注册与分组即可；UI 展示层只增不改，回滚无副作用。

## Open Questions

（无）
