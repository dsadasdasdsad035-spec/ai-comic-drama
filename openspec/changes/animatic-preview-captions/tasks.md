# Tasks

## 1. 共享字幕轨

- [x] 1.1 新增 `src/captions.ts`：`CaptionCue` 类型、按行/标点/长度切句、去掉说话人前缀并保留 speaker；用动态 import 验证多行、说话人前缀和超长句切分
- [x] 1.2 实现 cue 时间分配：TTS 用 `voiceSeconds + voiceOffset`，native/无配音按镜头时长估算，应用 `subOffset`、夹到镜头内、cue 间 60ms、最短 600ms；验证三条 cue 不重叠且不越界
- [x] 1.3 实现 `validateCaptions`：空文本、起止倒置、越界、重叠、单行 >18 字、>2 行、阅读速度 >8/12 字/秒、cue 过短/过长；验证错误与警告分级
- [x] 1.4 实现 `serializeSrt` 和共享字幕样式常量（字号比例、底部安全区、最大宽度、底色/文字色、行高）；验证 SRT 时间格式、cue 文本和换行
- [x] 1.5 确认旧项目从 `dialogue` 派生 cue、不写回任何字段；验证项目数据在播放/导出前后完全一致

## 2. 连播播放器

- [x] 2.1 让 `buildPlaylist` 保留 `EditItem.start/end`，新增 `layoutItems(items, durFix)` 按真实视频时长重算起点/总长；验证视频元数据变化后起点和总长更新
- [x] 2.2 用单一 `playheadSec` 驱动当前段、当前时间、活动 cue 和结束状态；实现当前镜头内 seek 和点击分段跳转；验证 5s 静帧在第 2.4s 显示正确时间
- [x] 2.3 实现音频池：视频全部 muted，TTS 用 `voiceUrl + voiceOffset`，native 用视频 URL，活动项 1–2 个 audio 元素同步播放；验证暂停/seek/静音和转场重叠时前后音频都按各自起点进入
- [x] 2.4 实现字幕 overlay：按 cue 绝对时间显示/隐藏，预览字幕开关独立于导出烧录；验证开关不影响 `burnSubs`
- [x] 2.5 重构播放控制：上一镜/播放/下一镜、当前时间、静音/音量、全屏、空格/左右键；验证全屏 Esc 顺序和画布快捷键不被触发
- [x] 2.6 分离播放控制与导出区；导出显示分辨率、烧录字幕、导出/下载 MP4+SRT、运行中耗时；验证导出区不与播放按钮混排
- [x] 2.7 预加载下一段媒体并处理缺失画面；验证转场开始前下一段已挂载、缺失媒体显示明确状态
- [x] 2.8 模态无障碍：`role=dialog`、焦点陷阱、打开聚焦、关闭归还、控件标签；验证 Tab 不逃出播放器、字幕 overlay 不抢焦点

## 3. 导出链路

- [x] 3.1 `ExportSegment` 增加相对 cue 和字幕样式；客户端在导出时发送 cue；拦截 `/api/assemble` 验证 payload 含 cue 时间/文本且不含说话人前缀
- [x] 3.2 服务端按真实 `starts[i]` 映射 cue、夹到真实段长、生成 SRT；验证 SRT 与 cue 逐字一致、越界 cue 被夹紧并回报
- [x] 3.3 无 libass 时为每条 cue 渲染 PNG 并用 `enable=between(t,start,end)` 叠加；验证同一镜头两条 cue 先后出现，不再整镜静态覆盖
- [x] 3.4 服务端返回 SRT sidecar 下载地址；验证下载 SRT 与烧录/预览 cue 一致，关闭烧录时不提供 SRT
- [x] 3.5 服务端检测 CJK 字体并把 `ffmpegAss` 设为“滤镜 + 字体都可用”；无字体时客户端走 PNG；验证 health 和上传路径
- [x] 3.6 移除从 `dialogue` 临时推导字幕的旧路径，保留类型兼容；更新受影响的导出调用和文档

## 4. 时间线与状态

- [x] 4.1 时间线 `Clip` 接入 `buildShotCaptions`，字幕行渲染多个 cue 块；验证三条 cue 显示为三个块
- [x] 4.2 保留拖动整组 cue 的 `subOffset` 行为，实时平移所有块；验证拖动后所有 cue 同步移动且数据只写 `subOffset`
- [x] 4.3 cue 块 title/摘要显示文本、speaker、timing；验证 native/无配音 cue 标记为估算

## 5. 验收与文档

- [x] 5.1 新增 `verify-preview-captions.mjs`：mock 项目 + 真实音频文件，断言 TTS 播放/暂停/seek、字幕 overlay 出现与消失、预览字幕开关、当前时间连续
- [x] 5.2 在同一脚本覆盖全屏/键盘、分段跳转、下一段预加载和缺失媒体状态
- [x] 5.3 重写 `verify-subs.mjs` 为断言脚本：cue 构建、SRT 内容、导出 payload、无 libass PNG cue 时序、SRT sidecar
- [x] 5.4 跑 `npx tsc --noEmit`、`verify-preview-captions.mjs`、`verify-subs.mjs`、`verify-video-prompt-preview.mjs`、`verify-export.mjs`，确认无回归
- [x] 5.5 截图验收：字幕开/关、TTS 状态、播放头/分段、导出分区；检查 360/480 宽度和日夜主题
- [x] 5.6 更新 README 的连播/字幕能力说明和 DEPLOY-CHECKLIST 的 libass/CJK 字体/PNG 兜底；验证文档中的入口名称与界面一致

## Workflow follow-up

- 评审通过后先 `/opsx:sync` 同步 `animatic-playback` 和 `caption-track`，再归档变更。
- 归档后复查主规格 Purpose 与实现是否一致，并更新证据目录。

## 6. 播放顺序修正

- [x] 6.1 `buildEditList` 先按 `episode + no` 自然排序；打乱 `project.json` shots 数组后，连播/时间线/导出仍按 S01..S04 播放，并验证 segment 顺序
- [x] 6.2 移除画面轨拖动换序，保留点击选中；时间线标注「按镜号」，拖动不改变节点顺序或镜号
- [x] 6.3 更新 `animatic-playback` 规格/设计和 README，跑 `npx tsc --noEmit` 与 `verify-preview-captions.mjs`
