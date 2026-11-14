# Tasks

## 1. 数据模型与水合

- [x] 1.1 `types.ts` / `ShotData` 增加 `prodKind?: 'image' | 'video'`；读写与 JSON 兼容
- [x] 1.2 实现 `inferProdKind(shot): 'image' | 'video'`（双轨优先 `video`）；项目加载时对缺字段镜头水合
- [x] 1.3 单元或 `verify` 夹具：双轨、仅图、仅片、空白四类断言

## 2. 创建与插入

- [x] 2.1 `BoardMenu` / `App.addShot` / `insertShotAfter`：创建前选择生图或出片；写入 `prodKind`
- [x] 2.2 插入默认类型：与锚点镜相同（或产品定的默认 `image`）

## 3. Inspector 与全局模式

- [x] 3.1 `visibleShotTabs` / `coerceShotTab` 改为 per-shot `prodKind`；移除 `canvasProdMode` 对 Tab 的控制
- [x] 3.2 删除或改写顶栏 `prod-mode-toggle`；`ShotNode` / 吸底 / 批量队列按 `prodKind` 互斥
- [x] 3.3 出片卡：迁 `ShotLexiconRefBlock` 与 `motionLexiconAsRef` 到视频 Tab

## 4. 与声音/播放接缝（若同期实施 canvas-prod-modes-no-voice）

- [x] 4.1 确认无「声音」Tab；台词在「更多」；与 `prodKind` 无交叉冲突
- [x] 4.2 播放/导出 R2 行为不因本变更回退

## 5. 验收与文档

- [x] 5.1 更新 `verify-shot-inspector.mjs` 及依赖 `prod-mode-toggle` 的脚本
- [x] 5.2 新增互斥断言：生图卡无视频主按钮、出片卡无 Seedream 主按钮
- [x] 5.3 `README` 画布生产改为按镜类型；`openspec validate shot-card-prod-kind --strict`

## Workflow follow-up

- 实现完成后运行 `/opsx-apply` 勾选任务，再 archive change；归档时合并 `shot-card-prod-kind` 新 spec 与三个 modified delta，并处理与 `canvas-prod-modes-no-voice` 中 `canvas-prod-mode` 的重复/作废文本。
