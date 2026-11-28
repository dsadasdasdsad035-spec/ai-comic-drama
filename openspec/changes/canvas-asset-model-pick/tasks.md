# Tasks

## 1. 模型解析

- [x] 1.1 在 `assetCardGeneration.ts` 增加 `resolveAudioModelKey` / 图像侧等价解析，并扩展 `verify-knowledge` 同类纯函数脚本或新建 `verify-asset-card-model.mjs` 覆盖「手选 / 默认 / 无效键」
- [x] 1.2 `generateAssetAudio` 与 `generateOne` 改用解析结果；空列表与未接入时客户端拦截，验证：对应用例在 verify 脚本中断言

## 2. 画布 Inspector UI

- [x] 2.1 `AssetPanel` 接收 `settings`、`pick`、`onPick`；图片卡显示 `CapModelSelect image`，音频卡显示 `CapModelSelect audio`，验证：选中两类素材卡时存在 `data-cap-model-select`
- [x] 2.2 生成按钮仍可点（模型不可用则生成前 toast/错误）；验证：扩展现有 UI 脚本或手工 `npm run dev` 选模型后 dryRun/mock 请求含 `modelKey`

## 3. 素材页规格对齐

- [x] 3.1 核对 `AssetBoard` 顶栏设定图模型与 `modelPick.image` 已满足规格；若缺 `data-cap-model-select` 或文案，补齐并验证：素材页 DOM 快照或 Playwright 一行断言

## 4. 回归

- [x] 4.1 `npx tsc --noEmit` 与相关 `verify-asset-card*.mjs` / 批量出图路径冒烟通过