# Tasks

## 1. 预置资源与校验

- [x] 1.1 拷贝 132 MP4 至 `public/presets/camera-moves-whitebox-132/` 并确认 `ls | wc -l` 为 132
- [x] 1.2 生成清洗版 `manifest.json`（`url` 指向 `/presets/...`）与 `ATTRIBUTION.md`
- [x] 1.3 新增 `verify-camera-lexicon.mjs`：校验 132 文件、`entries` 键一致、`primaryForMove/Size` 覆盖；`node verify-camera-lexicon.mjs` 通过

## 2. Catalog 模块

- [x] 2.1 实现 `src/cameraLexicon.ts`（fetch manifest、按 category/move/size 查询）并单测或 verify 覆盖查询 API
- [x] 2.2 在 `types.ts` 增加可选 `ShotData.lexiconRefKey` 与读写兼容（旧项目无字段）

## 3. MediaPicker 与选用落库

- [x] 3.1 `MediaPicker` 增加运镜库/镜头语法 Tab，预览与确认语义对齐 spec
- [x] 3.2 实现预置 MP4 复制进项目的服务端或现有上传路径；确认后 `kind=video`

## 4. 素材页与镜头表

- [x] 4.1 `AssetBoard` 镜头语言区：章节浏览 + 发布素材卡
- [x] 4.2 `ShotTable`/`Inspector`：景别/运镜预览、换参照、`lexiconRefKey` 持久化
- [x] 4.3 「发布参照到画布」与显式「运镜 reference_video」开关（默认关）

## 5. Agent 与提示词

- [x] 5.1 Agent 只读 `list_camera_lexicon` / `get_camera_lexicon` 工具
- [x] 5.2 `promptRender` 或等价层在存在 `lexiconRefKey` 时使用 catalog `en`

## 6. 文档

- [x] 6.1 README 增补预置运镜库路径、署名与选用说明

## Workflow follow-up

- 实现完成后运行 `/opsx-apply` 或按 change 勾选任务，再 archive change。
