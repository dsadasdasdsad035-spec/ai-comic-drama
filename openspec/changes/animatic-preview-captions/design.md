# Design

## Context

`src/Preview.tsx` 目前用 `idx` + 每段定时器推进播放，`buildPlaylist` 丢弃了 `EditItem.start`；`cur.voice` 没有被渲染成音频；字幕只在 `doExport` 里从 `dialogue` 临时生成。`src/subtitles.ts` 负责无 libass 时的整帧 PNG；`vite.config.ts` 的 `buildAnimatic` 在 SRT 路径从 `dialogue` 和 `voiceDur` 临时推导 cue。时间线字幕行只有一个镜头宽的块。See `proposal.md`、`specs/animatic-playback/spec.md`、`specs/caption-track/spec.md` for the required behavior; this document covers the implementation approach.

## Goals / Non-Goals

**Goals:**

- 一个播放头同时驱动画面、音频、字幕；时间显示是真实播放时间。
- 字幕成为共享 cue 轨，预览/导出/时间线/QC 使用同一份构建结果。
- TTS 和 native 音频都能在连播里听到，并在转场重叠时按各自段起点调度。
- 导出 SRT 与 PNG 兜底都按 cue 定时，修复无 libass 路径偏移失效。
- 不新增持久化字段，旧项目零迁移。

**Non-Goals:**

- 逐词/TikTok 高亮、cue 拖拽/拉伸/文本编辑、样式设置面板、软字幕、外部 SRT 导入、双语（后续变更）。
- 引入 Remotion 运行时或 Remotion 依赖；只借鉴 `Caption`/page/SRT 的模型和帧→毫秒播放头。
- 批量 Inspector、移动端布局、导出取消（保留现有任务台账和耗时显示）。
- 不在本次重写 ffmpeg 转场/色彩/混音逻辑。

## Decisions

### 1. 共享字幕由 `src/captions.ts` 派生，不落盘

新增纯模块：

```text
type CaptionCue = {
  id: string                 // `${shotId}:${index}`
  shotId: string
  text: string               // 默认已去掉「角色：」
  speaker?: string
  startOffsetMs: number      // 相对镜头起点
  endOffsetMs: number
  timing: 'voice' | 'shot' | 'native-estimate'
  estimated: boolean
}

buildShotCaptions(data, shotDuration): CaptionCue[]
validateCaptions(cues, shotDuration): { errors, warnings }
serializeSrt(cues with absolute times): string
```

预览、时间线、导出和校验都调用 `buildShotCaptions`，不存 `CaptionCue` 到 `ShotData`。旧项目天然兼容；P2 需要逐句编辑时再引入 `captionCues` 字段。替代方案是把 cue 存进项目：可编辑但需要迁移，而且本变更默认按句派生，先不采用。

### 2. 切句与时间分配

- 用 `parseDialogue` 得到每行的 speaker/text；显示文本用 text。
- 先按换行切，再按 `。！？!?；;` 切（保留标点）；单句超过 18 字时优先在 `，、,:：` 切，仍超长再硬切。
- 时间区间：
  - TTS：`[voiceOffset, voiceOffset + voiceSeconds]`，平移 `subOffset`，夹到 `[0, shotDuration]`。
  - native：按镜头时长估算，`timing='native-estimate'`。
  - 无配音：按镜头时长估算，`timing='shot'`。
- 按文本长度分配时长，cue 之间留 60ms，最短 600ms；总时长不足时按比例压缩，仍不满足则交给 validator 报错。
- `subOffset` 平移整组 cue 后夹到镜头内；越界/重叠由 validator 报错。
- 中文阅读速度：>8 字/秒警告，>12 字/秒错误；单行 >18 字、>2 行警告。
- 说话人前缀默认去掉；speaker 保留在 cue 里，P2 再做“显示说话人/双语”。

### 3. 播放顺序只由镜号决定

`buildEditList` 先按 `episode + no` 自然排序，再生成剪辑序列；`project.json` shots 数组顺序不再是播放顺序。时间线画面轨去掉拖动换序：拖动不再改节点顺序或镜号，只保留点击选中；时间线头部标注「按镜号」。要调整播放顺序，用户改镜号，而不是拖卡片。

替代方案是保留拖动换序并在拖动时重编号，但那会悄悄改镜号，和“顺序就是镜号”的约定冲突。另一个替代是继续用数组顺序，但那会让镜头表/剧本和连播不一致。都不采用。

### 4. 连播改为单一播放头 + 动态布局

`buildPlaylist` 保留 `EditItem.start/end`；新增 `layoutItems(items, durFix)`，按实际视频时长重算：

```text
for i:
  dur = durFix[item.id] ?? item.duration
  start = i === 0 ? 0 : prevEnd - joinIn.seconds
  end = start + dur
```

`playheadSec` 是唯一时间来源：

- `activeItems = items.filter(start <= t && t < end)`，按 start 升序。
- 主画面 = 最早 start 的活动项；转场期间第二个活动项作为 overlay。
- `ended = t >= total`。
- 播放时用 rAF 推进；主项是视频时用 `video.currentTime` 校正漂移，主项是静帧时用 `performance.now()`。
- `seekTo(t)` 夹到 `[0,total]`，同步所有媒体；点击分段 = `seekTo(itemStart(item))`，即跳到该段自己的可见区间。有入场效果转场时跳过重叠，避免点了 S02 还停在 S01；`goPrev/goNext` 同样使用这个起点。
- 替代方案是保留 `idx` + 段内定时器；但无法可靠处理重叠转场里的音频/字幕，放弃。

视频加载后发现真实时长变化时，`layoutItems` 重算起点；如果当前 `t` 超过新总长则夹到末尾，避免跳段。

### 5. 音频池：视频静音，音频单独调度

所有 `<video>` 元素 `muted`，音频由 `activeItems` 的 `<audio>` 池播放：

```text
for each active item with audio:
  TTS:    src = voiceUrl,      offset = item.start + max(0, voiceOffset)
  native: src = videoUrl,      offset = item.start
  none:   no element
  currentTime = clamp(t - offset, 0, duration)
```

- 只渲染活动项的 audio（通常 1–2 个）；离开活动区间即卸载/pause。
- 静音/音量状态应用到池中所有 audio。
- 这样转场重叠时，前后两段的 TTS/native 都按各自 `item.start` 开始，和导出的 `adelay` 起点一致。
- 替代方案是直接用主 video 音轨；但 overlay video 会被 muted，且无法在重叠区播放下一段音频，放弃。
- native 音频直接使用 `videoUrl` 作为 `<audio src>`；浏览器会复用缓存。若加载失败，回退为主视频音频并记录警告。

### 6. 字幕 overlay 与预览开关

- 当前绝对时间 `t` 落在 `item.start + cue.startOffsetMs/1000` 到 `item.end + ...` 之间时显示 cue。
- DOM overlay，不抢焦点；`captionPreviewOn` 与导出 `burnSubs` 分离。
- 样式常量集中在 `src/captions.ts`（字号比例、底部安全区、最大宽度、底色、文字色、行高）。PNG 渲染器和 DOM 使用同一组常量；ASS 使用同一组比例。
- 默认深色半透明底 + 白字 + 圆角；预览和 PNG 视觉一致。ASS 用 `BorderStyle=3 + BackColour` 近似方角底色，作为可接受的平台差异。
- 不做 CSS 进入/退出动画；字幕按时间出现/消失，避免预览与导出不一致。

### 7. 导出协议：cue 相对时间 + SRT sidecar + 定时 PNG

`ExportSegment` 增加：

```text
captions?: { startOffsetMs, endOffsetMs, text }[]
captionStyle?: { fontRatio, bottomRatio, maxWidthRatio, background, color }
```

- 客户端发送相对镜头起点的 cue；服务端在解析真实 `starts[i]` 后映射为绝对时间，并夹到 `r.dur` 内；越界/裁剪写入 `captionWarnings`。
- 服务端总是从 cue 写一份 SRT（不再从 `dialogue` 推导），有 libass 时用它烧录；同时把 SRT 复制到可下载位置，返回 `srtUrl`。
- 无 libass 时，客户端按 `expRes` 为每条 cue 渲染整帧透明 PNG，随 cue 发送 `sub` dataURL；服务端用 `overlay=...:enable='between(t,start,end)'` 逐条叠加，不再整镜静态覆盖。
- `dialogue` 字段保留在类型里仅为旧调用兼容；新客户端不依赖它，服务端不再从它解析字幕。
- SRT 时间使用 cue 的真实绝对起止；PNG 使用同一时间。`subOffset`/`voiceOffset` 已包含在 cue 相对时间里。
- SRT sidecar 与烧录逐字一致；关闭烧录时不发送 captions，也不返回 SRT。

### 8. 字体与平台一致性

- 服务端 `FF.ass` 改为“有 subtitles 滤镜 + 有可用 CJK 字体”才为 true；health 的 `ffmpegAss` 反映这个组合。没有 CJK 字体时客户端走 PNG，不输出方框。
- 字体选择：macOS 优先 PingFang SC；Linux 用 `fc-list :lang=zh` 找到 Noto Sans CJK / WenQuanYi；找不到则 `ass=false`。
- ASS 样式从 `captionStyle` 生成：`FontSize=fontRatio*H`、`MarginV=bottomRatio*H`、`MarginL/R` 根据 `maxWidthRatio`、`BorderStyle=3`、`BackColour` 半透明、`Alignment=2`。
- 预览 DOM 用同一组比例和浏览器字族；PNG 用 `renderSubtitlePng` 接收 style，不再硬编码。
- 已知差异：ASS 底色是方角、PNG/DOM 是圆角；在文档和导出提示中说明，不作为失败。

### 9. 校验与导出门禁

- `validateCaptions` 对每个镜头返回 errors/warnings：空文本、起止倒置、越界、重叠、单行过长、超过 2 行、阅读速度、cue 过短/过长。
- 导出面板列出问题；errors 禁用导出，warnings 需显式确认（复用现有确认模式）。
- 服务端对越界 cue 再做一次夹紧，并回传 `captionWarnings`，避免客户端校验和真实视频时长不一致时静默错位。
- 验收改为断言脚本：cue 构建、时间分配、SRT 文本、导出 payload、预览 overlay、无 libass 定时 PNG。

### 10. 时间线显示 cue 块

- `Timeline` 的 `Clip` 增加 `captions`（由同一 builder 派生），字幕行渲染多个块；宽度按 cue 时长。
- 拖动字幕行仍更新该镜 `subOffset`，实时 `live.dx` 平移所有块；逐条拖拽/编辑留给 P2。
- cue 块 title 显示文本、speaker、timing；`subOffset` 越界时沿用 validator 的警告。
- 这是“字幕是轨道对象”的最小可见化，不改现有拖动数据。

### 11. 连播 UI 与无障碍

- 头部：当前段、当前/总时间、音轨来源、画面类型、字幕开关、全屏、关闭。
- 主控制行：上一镜、播放/暂停、下一镜、当前时间、静音/音量、全屏。
- 导出区独立：分辨率、烧录字幕、导出、下载 MP4/SRT、状态/警告。
- 全屏用 `requestFullscreen`；Esc 在全屏时由浏览器退出，非全屏时关闭连播。
- 模态：`role="dialog" aria-modal="true"`，打开聚焦播放按钮，Tab 焦点陷阱，关闭归还焦点；字幕 overlay `aria-live="off"`。
- 下一段预加载：提前挂载隐藏的 `video preload="auto"`/`img`；转场 overlay 使用现有 fade 类，但媒体已就绪。

## Risks / Trade-offs

- [音频/视频漂移] → 单一 `t` + 媒体 `currentTime` 校正（>0.15s 才改）；定期校正而不是每帧硬设。
- [多个 audio 元素在转场重叠] → 只渲染活动项，通常两个；浏览器允许并行播放；native 音频复用视频缓存。
- [60fps React 重渲染] → 播放头用 ref + rAF，UI 状态按约 30fps 更新；字幕仅在活动 cue 变化时重渲染。
- [真实视频时长改变布局] → `layoutItems` 重算；播放中夹紧 `t`；UI 显示更新时间。
- [无 CJK 字体/无 libass] → health 关闭 `ffmpegAss`，自动走 PNG；PNG 由浏览器字族渲染。
- [ASS 与 PNG 底色方角/圆角差异] → 统一字号/位置/颜色/透明度；文档标注，作为已知平台差异。
- [旧调用只传 dialogue] → 新路径不解析 dialogue；旧调用没有字幕。保留类型字段但文档说明；验收脚本更新。
- [PNG payload 变大] → 只在不支持 libass 时发送；一条 cue 一张全帧 PNG，按镜头/句数估算可接受。
- [原生音频无词级时间] → cue 标记 `native-estimate`，头部显示估算；不声称精确同步。
- [预览与导出转场音频仍可能有毫秒级差异] → 音频池按 `item.start` 调度，和导出 `adelay` 同源；差异限制在浏览器解码启动延迟，文档说明。
- [相邻镜 cue 在转场重叠区可能同时有效] → 预览取开始更晚的一条；SRT/PNG 可能同时出现两条。P1 先按镜校验，跨镜裁剪留到 P2，并在文档中标注；无配音或大 `subOffset` 的镜头更容易触发。

## Migration Plan

无数据迁移。旧项目从现有字段派生 cue；`dialogue`/`voiceSeconds`/`subOffset`/`voiceOffset` 不改。服务端 `captions` 为可选字段；保留 `dialogue` 类型仅作兼容，不再驱动字幕。回滚时恢复旧 Preview 和 `buildAnimatic` 的 dialogue 解析；不影响已导出的成片。上线前跑新的 `verify-preview-captions.mjs`、重写的 `verify-subs.mjs`、`verify-video-prompt-preview.mjs`、`verify-export.mjs`。
