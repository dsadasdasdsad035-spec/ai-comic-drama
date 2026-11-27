# Proposal

## Why

画布出片镜的 Inspector 现在有三页（出片 / 音画 / 元数据），其中真正会进 `buildApimartVideoPayload` 的只有四样东西：`image_with_roles`、`video_urls`、`audio_url` 与 `prompt`。其余区块——就绪条、提示词合规审计、状态 chip、「提交给」模型块、`videoMeta` 历史、镜头参数、坐标与节点 ID、台词/字幕/表演/旁白 TTS——一个字节都不进请求，却占掉了大半屏。

用户要求：右侧维护栏只保留参考槽位（图片、视频、音频、提示词），删掉 Seedance 2.5 用不上的东西。模型只认这四样，其余展示没有实际作用。

## What Changes

- **出片镜 Inspector 收敛成单页 + 四槽位**。删掉 `音画` 与 `元数据` 两页，出片镜只剩 `出片` 一页；页内顺序固定为：参考槽位（图片 / 视频 / 音频 / 提示词）→ 生成设置 → 成片 → 吸底主操作。
- **图片槽位合并全部图片来源**：画布连线（角色 / 场景 / 道具 / 相邻镜 / 表情）+ 素材选择器 + 手工 URL（从元数据页迁入）。沿用现状不截断张数（`VIDEO_REFERENCE_IMAGE_LIMIT = null`）。
- **视频槽位合并全部视频来源**：连线视频素材 + 运镜库参照（从「镜头参数」迁入）+ 素材选择器。首期仍只提交第一条，其余显式列出被忽略原因。
- **音频槽位支持手选**：角色音色样本（按台词说话人自动带入）/ 素材库音频 / 画布连线音频素材 / 手填地址，单条。补 `collectAudioReferences`——当前 `shotReferences.ts` 把音频素材静默跳过。
- **原生音轨默认开启**（仅模型声明 `audioOut` 且为 Seedance 2.5 时）：程序 MUST NOT 逐镜判断"要不要带音轨"。`audioMode` 三态、无参考降级、多说话人降级、样本不合规降级整块删除；无可用音色样本时只发 `generate_audio`、不带 `audio_url`。
- **提示词是唯一必填**。四槽位皆可空，空槽位不阻止出片；`video_prompt` 为空才阻断。删除 `no-image` 与 `native-no-image` 两条闸门。
- **BREAKING**：台词、表演、字幕、旁白在画布 Inspector 不再有任何编辑入口，只由 Agent（`submit_shots` / `shots-v1`）与剧本导入写入；数据仍被字幕生成、音色推断与导出消费。
- **BREAKING**：`move === '固定'` → `camera_fixed` 随「镜头参数」区块一并删除，固定机位只能由剧本正文描述。
- **删除零引用死码**：`LipSyncPanel.tsx`、`VideoReferenceList`、`VideoReferenceSummary`、`TransitionNativeAudioBlock` 全仓库无人 import。

## Capabilities

### New Capabilities

- `shot-outgoing-slots`: 出片镜以图片 / 视频 / 音频 / 提示词四类参考槽位组织全部出片输入；四槽位是唯一能进请求的输入集合，槽位内容可空，正文是唯一必填项。

### Modified Capabilities

- `shot-inspector-layout`: 删除就绪条、状态 chip、音画 Tab 聚合与元数据页；出片镜收敛为单页槽位布局；提示词来源徽章对齐现状（正文 / 已手改 / 旧版本正文）。
- `shot-video-prompt`: 参考视频与参考图的唯一来源从「画布连线」改为「对应槽位」；删除「参考图超过 4 张省略」与「原生音频多说话人阻止」；运镜库配置位置从「运镜与语义」移入视频槽位。

## Impact

- 前端主要改动：`src/Inspector.tsx`（约 1700 行，重排为槽位面板）、`src/OutgoingVideoPromptPanel.tsx`（改写为槽位面板）、`src/inspectorLayout.ts`、`src/canvasProdMode.ts`、`src/videoPrompt.ts`、`src/shotReferences.ts`、`src/nativeAudio.ts`、`src/types.ts`、`src/shotSync.ts`、`src/App.tsx`、`src/agent/builtinPlatformTools.ts`。
- 待删除组件：`src/NativeAudioPanel.tsx`、`src/LipSyncPanel.tsx`、`src/CaptionPanel.tsx`、`src/NarrationPanel.tsx`、`src/PerformanceEditor.tsx`（均只被 Inspector 引用或零引用）；`captions.ts` / `narration.ts` / `performance.ts` 等纯逻辑保留。
- 服务端无协议改动：`server/app.ts:8154` 本来就是 `const mode = generateAudio ? 'native' : ...`，从不读客户端 `audioMode`；`buildApimartVideoPayload` 字段集不变。
- 验收脚本需同步 4 个：`verify-shot-inspector.mjs`（数 tab、`.si-chip`、`.native-audio-field`）、`verify-native-audio-ui.mjs`（整个语义消失）、`verify-shot-outgoing-duration.mjs`（读 `.si-chips`）、`verify-video-prompt-preview.mjs`（点 `#si-tab-meta`）。
- 与未实现变更 `canvas-prod-modes-no-voice`（0/12）**存在冲突**：它要求「台词与表演搬到更多 Tab」，本变更要求「台词与表演在画布无入口」。本变更优先；该变更的「台词与表演在更多页编辑」与其 Tab 组成条款需在 apply 前删除，其余部分（出图/出片模式切换、连播导出只用成片音轨、voice-synthesis 收窄）保持独立。
