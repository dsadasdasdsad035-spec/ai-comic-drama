# Tasks

## 1. 封面资源与数据契约

- [x] 1.1 新增 `scripts/gen-lexicon-posters.mjs`：读 `public/presets/camera-moves-whitebox-132/manifest.json`，用 ffmpeg（`-ss 0.8 -frames:v 1 -vf scale=480:-2 -q:v 4`）批量输出 `thumbs/<key>.jpg` 并回写 `poster` 字段；验证 `ls public/presets/camera-moves-whitebox-132/thumbs/*.jpg | wc -l` 为 132，且单张宽高比为 16:9
- [x] 1.2 `src/cameraLexicon.ts` 的 `CameraLexiconEntry` 增加可选 `poster`（并在需要时暴露顶层 poster 基路径）；验证 `npx tsc --noEmit` 通过且旧 manifest（无 poster）类型不报错
- [x] 1.3 扩展 `verify-camera-lexicon.mjs`：逐条校验 `poster` 文件存在、URL 以 `/presets/camera-moves-whitebox-132/` 开头、尺寸比例 16:9；验证 `node verify-camera-lexicon.mjs` 全绿
- [x] 1.4 在 `README.md` 的镜头语言库小节补一句“封面由 `scripts/gen-lexicon-posters.mjs` 生成，替换 MP4 后需重跑”；验证按文档命令原样执行可复现封面

## 2. 列表渲染改为封面优先

- [x] 2.1 `CameraLexiconBrowser` 的 tile 默认渲染 `<img src={entry.poster} loading="lazy" decoding="async">` 替代常驻 `<video>`；验证打开「镜头语言」后 DOM 中 `video` 元素数为 0
- [x] 2.2 hover / 键盘 focus 停留 150ms 后才挂载 `<video autoPlay muted loop playsInline preload="auto">`，移出或失焦即卸载；验证任意时刻播放中的 `video` 不超过 1，且快速扫过不触发起播
- [x] 2.3 `poster` 为空或图片 `onError` 时回退为 `<video preload="metadata">`；验证临时删除某条 poster 后该格仍可预览、其余格子不受影响
- [x] 2.4 `src/theme.css` 补封面层样式（`object-fit: cover`、占位底色、角标与播放指示保持可见）；验证列表滚动与切换筛选时无布局跳动

## 3. 检索稳定化

- [x] 3.1 搜索输入加 200ms 防抖后再参与 `listCameraLexicon` 过滤；验证连续快速输入只触发一次结果重建（可在筛选处临时计数确认）
- [x] 3.2 筛选结果集合变化时把 `.lex-grid` 的 `scrollTop` 置 0（关键词、分类、章节、语法分组均覆盖）；验证从 132 条缩到少量结果时首条可见
- [x] 3.3 在 `CameraLexiconBrowser` 旁补一条最小回归检查（沿用仓库 `verify-*.mjs` 风格或浏览器手测清单），覆盖“打开无视频元素 / hover 后恰好一个 / 搜索后回顶”三项；验证该检查可重复跑通

## 4. 集成验证

- [x] 4.1 跑 `npx tsc --noEmit`、`node verify-camera-lexicon.mjs`、`npm run build`，三项均通过
- [x] 4.2 浏览器走查：打开镜头语言（网络面板无 MP4 请求）→ hover 单条播放 → 切分类/章节 → 搜索缩短结果 → 清除筛选 → 离开再进入；确认无卡顿、无残留播放、署名仍可见

## Workflow follow-up

- 实现与验证完成后按项目评审要求归档 change。
- 归档前确认 `camera-moves-whitebox-lexicon` 与本 change 对 `camera-lexicon-presets` 的 delta 顺序不影响主 spec 合并。
