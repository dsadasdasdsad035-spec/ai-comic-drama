# Proposal

## Why

素材页「镜头语言」打开时会把预置 catalog 的 132 条条目一次性渲染成 132 个 `<video preload="metadata">`，而网格容器可见区域只有约 15–18 格。媒体元素数量、滚动合成开销，以及每次搜索/切分类/重新进入面板时的元素重建，共同造成可感知的卡顿。

搜索侧还有两个独立的小问题：输入未防抖，每敲一个字都会重建结果列表；结果变短时网格滚动位置不归零，容易停在空白区。

## What Changes

- 为预置 catalog 每条条目生成 16:9 静帧封面（poster JPG），写入 `public/presets/camera-moves-whitebox-132/thumbs/`，并在 manifest 中新增 `poster` 字段。
- 镜头语言网格默认只渲染 `<img>` 封面与文字；仅当 hover / 键盘 focus 时才挂载 `<video>` 播放，同一时刻最多一个视频元素。
- poster 缺失或加载失败时，回退到现有 `<video preload="metadata">` 行为，保证旧 catalog 与自定义来源不崩。
- 搜索输入加防抖（200ms 量级）；筛选结果集合变化时把网格滚动位置重置到顶部。
- 扩展 `verify-camera-lexicon.mjs`：校验每条 entry 的 `poster` 文件存在、URL 前缀正确、宽高比为 16:9。
- 不影响预置导入语义：`importCameraLexiconPreset` 仍只复制 MP4 进项目 media。

## Capabilities

### New Capabilities

- `camera-lexicon-presets`: 预置运镜/镜头语法 catalog 的缩略封面与按需播放契约——列表首屏 MUST NOT 创建视频元素，条目 MUST 提供可加载的 16:9 静帧封面。

### Modified Capabilities

<!-- 无：现有能力的要求不变。camera-lexicon-presets 尚未归档到 openspec/specs/，因此按新能力写入 delta。 -->

## Impact

- 渲染：`src/CameraLexiconBrowser.tsx`（tile 渲染与播放时机）、`src/theme.css`（封面层样式）
- 类型与数据：`src/cameraLexicon.ts`（`poster` 可选字段）、`public/presets/camera-moves-whitebox-132/manifest.json`
- 资源与脚本：新增 `scripts/gen-lexicon-posters.mjs` 与 `public/presets/camera-moves-whitebox-132/thumbs/*.jpg`
- 验证：`verify-camera-lexicon.mjs`
- 不改动：`server/cameraLexicon.mjs` 的导入路径、`Inspector.tsx` 的运镜参照下拉、`MediaPicker.tsx` 的全量映射

## 依赖说明

`camera-lexicon-presets` 能力目前只存在于未归档的 `camera-moves-whitebox-lexicon` change 中。本 change 的 delta 以 `ADDED Requirements` 形式追加该能力的新要求，与前者归档顺序无关。
