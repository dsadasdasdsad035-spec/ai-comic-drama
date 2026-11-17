# Proposal

## Why

转场出片能提交参考图、参考视频与角色音色，但 Agent 只能"看结果"、不能"做选择"：`submit_joins` 契约里只有提示词相关字段，`generated.refIds` / `audioMode` / `audioRef` 没有任何写入口。更糟的是 `passthrough` 让多余键不报错，Agent 传了参考也会被静默丢弃，而面板默认收起的纯文字附件列表又让人看不出究竟送了几张图。结果就是模型只能凭镜号臆测 `[图N]`，参考素材实际上退化成"人在画布上点"。

## What Changes

- **参考候选可见**：`read_transition_video_inputs` 增加候选池投影（`candidates[]`，含 `token`、`label`、来源、是否已提交）与一句 `summary`（如"候选 5 项，已提交 0 项"），空提交也说得清。
- **参考可写**：新增 `attach_transition_refs`，按角色名/素材标题/URL 寻址，`add` 并集、`remove` 只减目标项，写入 `generated.refIds` 并回写后返回 `[图N]` 顺序。Agent 不再需要手拼 `asset-<canvasId>` / `char-<id>`。
- **原生音频可写**：新增 `set_transition_audio`，只接受 `mode` 与 `character`（角色名），音色由系统从 `voiceSample` 解析，不接受模型传 URL；样本缺失/失效/多说话人时返回 blocking 原因而不写入。
- **出片区看得见**：转场生成区与提示词面板的附件列表补缩略图、来源标签（角色/素材/手工 URL）与「Agent 写入」标记；默认展开的参考素材条保证不点折叠也能核对。
- **修 spec 漂移**：「风格参考可继承、排除与增补」与「转场参考与边界高级编辑」仍写着默认继承与继承开关，而代码里 `inheritRefs` 恒为 `false`、面板无开关。本次把两条 requirement 对齐到"只认显式选择的参考"。
- **不做**：音频素材卡（BGM/环境音）作为转场参考音频。APIMart 只接受单个 `audio_url`，与角色音色二选一，首期不引入第二槽位。
- **不做**：`submit_joins` 契约扩字段。参考走独立工具，避免 `passthrough` 继续吞掉拼错的键名。
- **不做**：Agent 生成角色音色样本（`voiceSample` 仍只在角色卡 UI 生成），本变更只保证样本缺失时 blocking 文案可执行。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`: 参考选择语义改为"只认显式选中"；新增候选池投影、Agent 参考写入、Agent 原生音频开关、出片区参考素材可见性四条 requirement；删除已不存在的继承开关描述。
- `creative-asset-tools`: 新增两条转场参考工具（`attach_transition_refs`、`set_transition_audio`）纳入平台工具清单与默认专家白名单。

## Impact

- 工具层：`src/agent/stageTools.ts`（投影扩展）、新增 `src/agent/transitionRefTools.ts`、`src/agent/builtinPlatformTools.ts`（装配）、`src/skills/tools.ts` 与 `src/creative/expertToolGroups.ts`（清单与分组）。
- 引擎层：`src/transitionGen.ts`（候选池与音频能力投影导出）、`src/nativeAudio.ts`（音频门禁原因复用）。
- 写入层：`src/shotJoins.ts` 或转场写回辅助（新增 refIds/audioMode 写回路径，保持 `handEdited` 语义）。
- UI：`src/TransitionPanel.tsx`、`src/OutgoingVideoPromptPanel.tsx`（缩略图与来源标签）。
- 专家：三套内置专家 `soul.md` 增加"先读候选再选参考"的指引。
- 测试：`tests/transition-read.ts`、`tests/expert-manifests.ts`。
- 依赖：`transition-video-inputs` 的投影契约需先落地（同一工具、同一份预览计算）。
