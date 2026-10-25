# Proposal

## Why

「连播」是画布工作流的最后一道人工验收，但当前它只是一个按镜头推进的视觉 animatic：TTS 镜头完全无声，字幕在预览里不可见，头部时间是当前镜头结束点而不是播放进度；字幕只在导出时临时生成，时间线只能拖一个整镜偏移。用户无法在导出前判断声音、字幕和节奏，问题要等到最慢的导出之后才暴露。字幕在 SRT 与无 libass 的 PNG 兜底之间还存在时序/样式不一致。

## What Changes

- 新增共享字幕轨：从 `dialogue` 按句/标点生成 cue（默认按句，不做逐词高亮），自动去掉说话人前缀，记录 `startOffsetMs/endOffsetMs`（相对镜头起点）；有 TTS 时按配音时长分配，没有 TTS/native 时按镜头时长估算并标记。预览、导出、时间线、校验共用同一个构建结果。
- 连播新增连续播放头：当前时间、镜头内进度、在当前镜头内 seek、点击分段跳转；`playhead` 驱动视频、TTS/native 音频和字幕，不再用“段末时间”冒充播放时间。
- 连播新增 TTS 音频播放：按 `voiceOffset` 对齐，暂停/继续/seek 同步；native 镜头继续使用视频音轨；新增静音/音量。转场重叠时按各段真实起点调度音频，尽量与导出一致。
- 连播新增字幕 overlay：按 cue 的 `start/end` 显示/隐藏，预览字幕开关与“导出烧录字幕”分离；头部显示本镜音轨、字幕、画面状态。
- 连播基础播放器能力：上一镜/下一镜、空格/方向键、全屏、导出设置与播放控制分区、下一段预加载、`role="dialog"`/焦点陷阱/Esc 归还。
- 导出改用同一份 cue：服务端接收相对镜头起点的 cue，SRT 直接按 cue 写；没有 libass 时按 cue 生成定时 PNG overlay（`enable=between(t,...)`），不再整镜静态覆盖，修复拖字幕偏移在兜底路径失效的问题。
- 增加 SRT 下载（sidecar），内容和烧录用的 cue 完全一致；说话人前缀默认不进字幕，只在数据里保留 speaker。
- 字幕校验：cue 重叠、越过镜头边界、起止倒置、空文本、最大行数/字数、阅读速度；错误阻止导出，警告要求确认。
- 时间线字幕行显示 cue 块（P1 只读展示；拖动字幕行仍作为整镜 `subOffset` 平移），为 P2 的逐句编辑打基础。
- 明确不做：逐词/TikTok 高亮、cue 拖拽/拉伸/文本编辑、字幕样式设置、软字幕、外部 SRT 导入、双语、Remotion 运行时、改 ffmpeg 色彩/转场；这些留到后续变更。

## Capabilities

### New Capabilities

- `animatic-playback`: 连播播放器的连续播放头、TTS/native 音频、播放控制、全屏、状态呈现和无障碍行为。
- `caption-track`: 从台词生成共享字幕 cue、预览叠加、SRT/PNG 导出一致性、SRT sidecar 和字幕校验。

### Modified Capabilities

无。现有 `voice-synthesis` 继续负责 TTS 渠道；本变更只消费配音结果，不改其契约。

## Impact

- 前端：新增 `src/captions.ts`（cue 构建、校验、SRT 序列化、共享样式）；`src/Preview.tsx` 改为播放头驱动并加入音频/字幕/全屏；`src/Timeline.tsx` 字幕行显示 cue；`src/subtitles.ts` 与导出样式共享参数；`src/api.ts` 的 `ExportSegment` 增加 cue。
- 服务端：`vite.config.ts` 的 `buildAnimatic` 接收 cue，SRT 直接按 cue 写入；无 libass 时按 cue 叠加定时 PNG；不再从 `dialogue` 临时推导字幕。
- 数据：不新增持久化字段；旧项目从 `dialogue` + `voiceSeconds` + `subOffset` + `voiceOffset` 派生 cue，零迁移。P2 若要编辑 cue 再考虑落盘。
- 验证：新增 `verify-preview-captions.mjs`（播放头/音频/字幕/seek/SRT）；重写 `verify-subs.mjs` 为断言脚本；`verify-video-prompt-preview.mjs` 等现有脚本保持通过。
- 文档：README 更新连播和字幕能力说明；DEPLOY-CHECKLIST 补充 SRT/PNG 两条路径、CJK 字体和 libass 探测风险。
- 参考：Remotion captions 的 `Caption`/page/`parseSrt`/`serializeSrt` 模型与“帧→毫秒”播放头；`video-edit-assembly` 的 typed subtitle track 和 `validate → render_preview → qc` 交付规则。只借鉴模型和验收方式，不引入 Remotion 运行时。
