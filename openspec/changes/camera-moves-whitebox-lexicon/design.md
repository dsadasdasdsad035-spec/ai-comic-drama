# Design

## Context

见 `proposal.md`。预置资源已位于 `public/presets/camera-moves-whitebox-132/`（132 MP4 + `manifest.json` + `ATTRIBUTION.md`）。运行时媒体仍走 `public/videos/`（gitignore）；预置 URL 为 `/presets/camera-moves-whitebox-132/<key>.mp4`。

## Goals / Non-Goals

**Goals:**

- 单一 catalog 源（`manifest.json`）驱动运镜库 / 镜头语法浏览、映射与 Agent 只读查询。
- 选用语义与现有素材卡一致：确认后才写 URL；视频 `kind` 为 `video`；复制进项目目录后用于出片与持久化。
- 镜头表 `size`/`move` 与 catalog 松耦合：仅推荐 `primaryForMove` / `primaryForSize`，进阶条目不改变枚举。

**Non-Goals:**

- 新 `AssetKind` 枚举值；不把 132 段扫进 `listMedia` 的视频目录列表。
- 自动把运镜参考连到分镜或默认提交 `reference_video`。
- 在仓库内重编码或裁剪 MP4；不把 `verification/`、`contact-sheet.png` 入库。

## Decisions

### D1：Catalog 加载

- **选择**：构建时将 `public/presets/.../manifest.json` 复制或 import 到 `src/cameraLexicon.json`（或通过 `fetch('/presets/.../manifest.json')` 懒加载）。
- **备选**：仅运行时 fetch — 利于热更新 manifest，但首屏多一跳；首期可用 **fetch + 内存缓存**，避免把 132 条 metadata 打进 JS bundle 两次。

### D2：媒体类型与标签

- **选择**：`kind: 'video'`，`tags` 含 `lexicon:camera-moves-whitebox-132`、`lexicon:move:<枚举>` 或 `lexicon:grammar:<group>`。
- **备选**：新 kind — 改动面过大，否决。

### D3：选用落项目

- **选择**：与 stock 类似，POST/现有上传管道把预置 MP4 复制到 `projects/<name>/assets/` 或 `public/videos`（遵循现有 `uploadImageFile`/视频保存惯例），返回项目内 URL 写素材卡。
- **备选**：长期引用 `/presets/...` — 不利于打包迁移与离线一致性。

### D4：镜头表参照字段

- **选择**：`ShotData.lexiconRefKey?: string`（可选）；空则按 `mapsToMove`/`mapsToSize` 显示默认预览，不写回 shot。
- **备选**：只存在 project `assets` 外键 — 查询慢且难默认值。

### D5：reference_video

- **选择**：Inspector 显式开关「运镜参考」；开启后允许将已选 lexicon 视频卡参与连线，行为与现有视频素材一致（首期仍只取第一条）。
- **默认**：关闭。

### D6：Agent

- **选择**：`list_camera_lexicon` / `get_camera_lexicon` 只读工具，参数 `category`、`move`、`size`、`q`；返回 `key,cn,en,url,sectionTitle`。
- **技能**：`shot-video-prompt` 模板增加一句「运镜英文名优先用 catalog `en`」。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 仓库 +116MB | 文档说明；可选未来 LFS |
| 白膜主体污染 Seedance 画面 | 默认不连线；UI 文案 + 运镜参考开关 |
| 枚举与 132 条不对齐 | `mapsToMove` 仅 8 条 primary；其余分类浏览 |
| manifest 与 MP4 不同步 | `verify-camera-lexicon.mjs` 校验键与文件 |

## Migration Plan

1. 资源与 manifest 已入库；合并后现有项目无迁移。
2. 发布说明：预置库路径与署名。
3. 回滚：删除 presets 目录与 feature 旗标即可；已复制进项目的视频保留。

## Open Questions

- 是否在设置页增加「禁用预置运镜库」开关（低优先级）。
- `04_tilt` 是否在镜头表增加「俯仰」枚举（暂不，放进阶库）。
