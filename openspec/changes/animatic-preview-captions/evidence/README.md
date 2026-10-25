# 连播与字幕验收图

由 `node verify-preview-captions.mjs` 和 `node verify-subs.mjs` 生成；项目数据是脚本内 mock，不写真实项目。

- `preview-captions.png`：连播播放到 3.3s，TTS 4.8s、预览字幕开，显示第二句 cue。
- `preview-captions-off.png`：关闭「预览字幕」后 overlay 消失，导出烧录开关不受影响。
- `preview-captions-export.png`：导出完成，显示 MP4/SRT 下载和 cue 统计。
- `preview-captions-after.png`：画布时间线字幕轨显示多条 cue（S01 两条、S02 一条、S03/S04 估算）；拖动整组后同步平移。
- `preview-captions-night.png`：夜间主题下的同一连播画面。
- `cap-frame-1.png` / `cap-frame-2.png`：真实 ffmpeg SRT 导出在 0.5s / 1.5s 的烧录帧，验证 cue 起止。

脚本同时故意打乱 `project.json` shots 数组，验证连播/时间线/导出仍按镜号 S01..S04 排序；画面轨拖动不改变顺序或镜号。

脚本覆盖：TTS/native 音频、转场重叠时两段音频、连续播放头、镜头内 seek、分段跳转、暂停/静音、键盘、全屏、预加载、缺失画面、预览/烧录字幕分离、导出 payload、PNG 兜底和 SRT sidecar。
