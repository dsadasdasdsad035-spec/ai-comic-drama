# Design

## Context

- 预置 catalog 是构建期打包的静态 JSON（132 条：100 运镜 + 32 镜头语法），MP4 共 111.2 MB，均 863 KB，且全部为 faststart（`moov` 在 `mdat` 之前），`preload="metadata"` 的元数据请求很小。
- 列表容器固定高度滚动（`max-height: min(58vh, 560px)`），可见约 15–18 格；但当前实现会把筛选结果全部渲染成 `<video preload="metadata">`。
- `CameraLexiconBrowser` 在离开素材页「镜头语言」时整块卸载，再次进入会重建全部元素。
- 项目无虚拟滚动依赖；`package.json` 中无 `react-window` / `@tanstack/react-virtual`。
- 仓库已有 `scripts/` 目录存放一次性脚本，`verify-camera-lexicon.mjs` 负责 catalog 一致性，`vite.config.ts` 内已有 ffmpeg 二进制候选路径解析逻辑可参考。
- 详见 `proposal.md`；行为契约见 `specs/camera-lexicon-presets/spec.md`。

## Goals / Non-Goals

**Goals:**

- 打开「镜头语言」时列表不创建任何视频元素，滚动与反复进出面板稳定。
- 每条条目具备可辨认的 16:9 静帧封面，且封面资源总量控制在 1 MB 量级。
- 检索时列表稳定：输入停顿后才更新，结果变化后回到顶部。
- 旧 catalog（无 `poster` 字段）仍能正常展示。

**Non-Goals:**

- 不给 `listCameraLexicon` 增加 `offset` / `total`，不做数据层分页。
- 不改 `Inspector.tsx` 的 `limit: 132` 下拉，不改 `MediaPicker.tsx` 的全量映射。
- 不给已发布素材卡补封面（`onPublishAsset` 仍只传 `title/kind/url`）。
- 不引入虚拟滚动；132 条规模下封面方案已足够。

## Decisions

### 1. 用构建期生成的静帧 JPG 作为封面

- 抽帧参数：`-ss 0.8`（4s 片的 20% 处，构图已展开）、`scale=480:-2`、`-q:v 4`，输出 `public/presets/camera-moves-whitebox-132/thumbs/<key>.jpg`。
- 实测 320px / q5 单张约 3 KB，132 张约 448 KB；480px 仍在 1 MB 量级，远小于 MP4 总体积。
- 备选：运行时抽帧（首屏 CPU 高、要额外解码）、WebP（链路与兼容性收益不足以抵消排查成本）。选 JPG。

### 2. manifest 增加可选 `poster` 字段

- 每条 entry 增加 `poster`，顶层可选 `posterBasePath`；`CameraLexiconEntry.poster?: string`。
- 可选字段保证旧 manifest / 旧数据不报错，支持“先发代码、后补资源”的发布顺序。

### 3. 网格默认只挂封面，hover/focus 才挂视频

- 未激活条目：`<img src={poster} loading="lazy" decoding="async" alt="">`。
- `playingKey === entry.key` 时才渲染 `<video src={entry.url} autoPlay muted loop playsInline preload="auto">`，移出/失焦即卸载。
- 同一时刻最多一个视频元素（沿用现有单值 `playingKey`）。
- 备选：保留 132 个 `video` 但设 `preload="none"`（元素数不变，仍占内存与合成层）；`content-visibility: auto`（省绘制但不省元素与请求）。两者都不解决根因。

### 4. hover 起播延迟 150ms

- 鼠标扫过网格时不连续起播 863 KB 的 MP4；仅停留超过阈值才加载视频。
- 键盘 focus 同样走该路径，保证可访问性不退化。

### 5. poster 缺失时的回退

- `poster` 为空或图片 `onError` 时，该格子回退为现有 `<video preload="metadata">`，与今天行为一致。

### 6. 检索稳定化

- `q` 增加 200ms 防抖后再参与筛选；`entries` 集合变化时把网格 `scrollTop` 置 0。
- 分类/章节/语法分组的切换同样视为集合变化，一并重置滚动。

### 7. 校验与生成脚本

- `scripts/gen-lexicon-posters.mjs`：读 manifest，按 key 批量抽帧并回写 `poster`；支持全量重跑与断点跳过（已存在且可读则默认复用）。
- `verify-camera-lexicon.mjs` 新增：每条 entry 的 `poster` 文件存在、URL 前缀为 `/presets/camera-moves-whitebox-132/`、抽出的宽高比为 16:9。

## Risks / Trade-offs

- [静帧丢失运动信息] → hover/focus 播放补偿；移动端由详情区完整视频兜住。
- [poster 与 MP4 漂移（重渲染后忘重跑脚本）] → verify 校验文件存在与比例；脚本默认全量覆盖，文档标注“换 MP4 后重跑”。
- [hover 仍会拉 863 KB 单条 MP4] → 延迟 150ms + 单实例；后续若要更省可另做 720p 预览小片，不在本次。
- [快速扫过时 play/pause 抖动] → 延迟阈值 + 移出即卸载，避免残留播放器。
- [132 个 `<img>` 仍在 DOM] → 图片节点远轻于视频；若仍有滚动压力，后续可叠 `content-visibility`，不需改结构。
- [旧 catalog 无 poster] → 回退分支覆盖，不阻塞发布。

## Migration Plan

1. 先合代码（渲染与类型改动）：无 `poster` 时自动回退，现网行为不变。
2. 跑 `node scripts/gen-lexicon-posters.mjs` 生成 `thumbs/` 并回写 manifest，提交资源。
3. 跑 `node verify-camera-lexicon.mjs` 确认封面覆盖完整。
4. 回滚：删除 `poster` 字段或保留资源都不影响运行；渲染层回退分支天然向后兼容。
