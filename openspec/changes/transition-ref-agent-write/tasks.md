# Tasks

## 1. 候选池投影

- [x] 1.1 在 `src/transitionGen.ts` 导出候选投影辅助：由 `transitionRefCandidates` 与 `effectiveTransitionRefs` 求交，产出 `{ token, label, source, url, submitted }[]` 与"候选 N 项、已提交 M 项"摘要；占位角色 `char-miss*` 与非图片素材必须排除。验证：新增 `tests/transition-refs.ts`，断言候选去重、占位与视频/音频素材卡不入选。
- [x] 1.2 扩展 `read_transition_video_inputs` 返回 `candidates`、`candidateSummary`；`refs` 为空时仍返回完整候选。验证：`tests/transition-read.ts` 增用例——`refIds` 为空但候选池有 4 项时，`candidates.length === 4` 且全部 `submitted: false`，摘要含 0。
- [x] 1.3 同一工具补 `audio.caps`（`supported`/`minSeconds`/`maxSeconds`/`requestSeconds`）与 `audio.sample`（`character`/`seconds`/`stale`），按"若开启原生音频"的请求秒数试算。验证：`tests/transition-read.ts` 断言无台词、无样本、多说话人三种情形各自给出不同 `reason`，样本齐全时给出 sample 且请求秒数抬到 5。

## 2. 参考写入工具

- [x] 2.1 新增 `src/agent/transitionRefTools.ts` 并实现 `attach_transition_refs`：按 `after_no` + 可选 `to_no` 定位接缝，`kind` 为 `character`/`asset`/`url`，`names` 上限 8，`add` 幂等并集、`remove` 只减目标项，写回 `transition_out.generated.refIds`。验证：新增 `tests/transition-refs-write.ts`，断言连续两次 `add` 同一角色结果不变（幂等）。
- [x] 2.2 失败路径：名字找不到、同名歧义、占位角色、URL 不在候选池、接缝不存在均返回 `ok: false` 且 `refIds` 保持原值，错误信息列出候选。验证：同上测试逐条断言写入前后 `refIds` 深等。
- [x] 2.3 写入后返回按提交顺序编号的 `refs`（含 `index`、`label`、`source`），且不追加 `handEdited`。验证：测试断言返回值 `refs[i].index === i + 1`、镜头 `handEdited` 未包含 `transition_out`。

## 3. 音频写入工具

- [x] 3.1 实现 `set_transition_audio`：只接受 `mode: native|off` 与可选 `character`，音色由 `voiceSample` 解析；门禁复用 `audioRefCapabilitiesFor` 与 `nativeAudioRef`，用 `transitionRequestSeconds` 试算请求秒数并回传 `requestSeconds`/`trimTo`。验证：`tests/transition-refs-write.ts` 断言开启成功后 `audioMode === 'native'`、`audioRef.url` 等于角色样本地址、`audioMeta.fingerprint` 与出片一致。
- [x] 3.2 失败分类文案：模型不支持 / 无可用样本（指向角色卡）/ 样本失效 / 台词缺失 / 多说话人；`mode: off` 同时清空 `audioRef` 与 `audioMeta`。验证：测试逐条断言 `ok: false` 的 `reason` 含对应关键词且配置未变；`off` 后两字段为 `undefined`。
- [x] 3.3 工具说明中写明"不接受音频地址、只接受角色名"，避免模型传 URL。验证：`tests/creative-tools.ts`（或新增断言）检查工具描述包含该约束。

## 4. 工具清单与专家授权

- [x] 4.1 把两个工具注册进 `src/skills/tools.ts` 与 `src/agent/builtinPlatformTools.ts` 的装配，并在 `src/creative/expertToolGroups.ts` 归入画布/物料分组。验证：`npx tsx tests/expert-manifests.ts` 全绿，且平台工具名清单包含两项。
- [x] 4.2 三套内置专家（`expert-omni`、`expert-omni-custom`、`expert-omni-custom-2`）白名单勾选两个新工具，`soul.md` 增加指引：写转场提示词前先用 `read_transition_video_inputs` 看候选与 `[图N]`，需要补参考时用 `attach_transition_refs`，需要角色音色时用 `set_transition_audio`。验证：`tests/expert-manifests.ts` 断言三套专家工具集包含两项且默认集一致。

## 5. 出片区可见性

- [x] 5.1 `OutgoingVideoPromptPanel` 的 `vp-refs` 每条渲染缩略图、来源标签（角色/素材/手工 URL），保持 `[图N]` 序号与投影一致。验证：转场提交 3 张不同来源参考时，面板显示 3 个缩略图且标签正确（截图核对）。
- [x] 5.2 转场出片区新增默认可见的参考素材条：零参考时显示"无参考图"，有参考时显示缩略图与名字，不依赖展开折叠。验证：分别构造 0 张与 3 张参考两种状态截图核对。
- [ ] 5.3 Agent 写入标记：工具成功写回后经 `onTransitionRefsWritten(edgeId, tokens)` 记入 App 级内存 `Map`，对应条目显示 Agent 标记；刷新后标记消失但参考保留。验证：手工跑一次 Agent 写入，确认标记出现、刷新后参考仍在而标记消失。（需真实模型会话）

## 6. 集成验证

- [x] 6.1 A/B 一致性：同一接缝分别用 `attach_transition_refs` 写入与面板勾选同一组参考，`read_transition_video_inputs` 返回的 `refs` 顺序与 `label` 完全一致。验证：`npx tsx tests/transition-refs-write.ts` 的 parity 用例。
- [x] 6.2 `npx tsx tests/transition-read.ts && npx tsx tests/transition-refs.ts && npx tsx tests/transition-refs-write.ts && npx tsx tests/expert-manifests.ts` 全绿，`npx tsc --noEmit` 无错，`openspec validate transition-ref-agent-write --strict` 通过。
