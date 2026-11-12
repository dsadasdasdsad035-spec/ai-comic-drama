# Proposal

## Why

分镜生产中的「运镜」「景别」目前主要是文字枚举与提示词，缺少可预览、可引用、可对齐意图的标准视频参照。项目已获得 132 段白膜运镜库（`camera-moves-whitebox-132`），规格统一，适合作为内置镜头语言 catalog，贯穿素材选择、镜头表编辑、画布 `reference_video` 与 Agent 写提示词。

## What Changes

- 将 132 段 MP4 与清洗后的 `manifest.json` 纳入仓库 `public/presets/camera-moves-whitebox-132/`（已完成资源落盘）。
- 新增运行时 catalog 读取层（`src/cameraLexicon.*`），按 `lexiconCategory`（运镜 / 镜头语法）、章节、`mapsToMove` / `mapsToSize` 检索。
- MediaPicker 增加「运镜库」「镜头语法」分类，支持预览、搜索、选用后复制进项目并建 `video` 素材卡。
- 素材页增加「镜头语言」浏览区（与 scene/prop 设定分离），可选用预置或用户上传同类视频。
- 镜头表 / Inspector：在 `size`、`move` 旁展示默认参照片预览，可更换 catalog 条目；**不**自动改写用户已填枚举（进阶运镜仅挂参考）。
- 画布出片：`reference_video` **默认不自动连线**；Inspector 提供显式「作为运镜参考」动作。
- Agent / 镜头表技能：只读列出 catalog 条目，写 `video_prompt` 时引用标准英文名与用途说明。
- 署名与说明：UI 展示 `hong hou zi` 与 `ATTRIBUTION.md` 摘要。

## Capabilities

### New Capabilities

- `camera-lexicon-presets`：内置白膜运镜 catalog 的存储、元数据、检索、映射到 `MOVES`/`SHOT_SIZES` 与选用进项目的语义。

### Modified Capabilities

- `asset-media-picker`：新增预置运镜/镜头语法来源、预览与选用落库。
- `scene-prop-design`：素材工作台增加镜头语言浏览（非 scene/prop design 流）。
- `shots-workbench`：景别/运镜列（或 Inspector）绑定 catalog 参照预览与选用。
- `shot-video-prompt`：技能/拼装可引用 catalog 标准术语（只读）。
- `workbench-chat-context`：Agent 读工具暴露 catalog 查询（只读）。

## Impact

- **静态资源**：仓库增加约 116MB MP4（`public/presets/`，不进 `.gitignore` 的 `videos/`）。
- **前端**：`MediaPicker`、`AssetBoard`、`Inspector`/`ShotTable`、`mediaPick.ts`、新增 `cameraLexicon` 模块。
- **Agent**：`stageTools` 或镜头表宿主增加只读 lexicon 工具/上下文片段。
- **验证**：`verify-camera-lexicon.mjs`（132 文件、catalog 键、映射完整性）。
- **无 BREAKING**：现有 `AssetKind` 保持 `video` + tags，不破坏已有素材卡。
