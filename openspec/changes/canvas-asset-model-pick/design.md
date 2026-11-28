# Design

## Context

- 出片镜已有 `VideoOutgoingModelRow` + `modelPick`（localStorage `storyboard-model-pick`）。
- 素材页 `AssetBoard` 顶栏已有 `CapModelSelect cap="image"`，绑定 `modelPick.image`。
- 画布 `AssetPanel` 仅有提示词与生成按钮；`generateOne` / `generateAssetAudio` 已读 `modelPick`，音频路径用 `audioModelReady` 且对手选过严。
- 共享组件：`CapModelSelect`、`capModelEntries`、`defaults.image` / `defaults.audio`。

## Goals / Non-Goals

**Goals:**

- 图片/音频素材卡 Inspector 各一行模型下拉，与出片体验一致。
- 解析顺序：手选 modelKey → 设置页 defaults → 可读错误（无效/未接入/列表为空）。
- 素材页行为写入规格，实现以现状为主，仅补缺不重构 AssetBoard。

**Non-Goals:**

- 每张卡或每张设定卡存 `modelKey` 到项目 JSON/SQLite。
- 镜头 ratio/candCount/refMode 搬到素材卡 Inspector（另开变更）。
- 角色配音 per-character 模型（仍见 `character-per-voice-model`）。

## Decisions

1. **会话级手选，不 per-card**  
   - 理由：与设定图顶栏、批量出图一致，改动面小。  
   - 备选：写在 `ProjectAsset.extra.modelKey` —— 批量与 Agent 成本高，否决。

2. **在 `AssetPanel` 内嵌 `CapModelSelect`，不新建组件**  
   - 图片：`cap="image"`，`caps={IMAGE_CAPS}` 与设定图一致。  
   - 音频：`cap="audio"`，列表过滤 `isRunnableModel`。  
   - `AssetPanel` 增加 `settings`、`pick`、`onPick` props，由 `Inspector` 分支传入（与 `InspectorBody` 相同来源）。

3. **音频默认解析**  
   - 抽取或扩展 `assetCardGeneration.ts`：`resolveAudioModelKey(pick, settings)` → `audioModelReady` 入参改为解析后的 key。  
   - 与 `CapModelSelect` 展示的默认项对齐，避免「下拉显示默认 · X」但点击生成仍报未选择。

4. **图片侧预检（可选同文件）**  
   - 出图前若 `capModelEntries` 为空或解析到 `invalidKey`，在客户端拦截，文案与设定图生成一致。

5. **验证**  
   - 纯函数：`resolveAudioModelKey` / 图像等价解析。  
   - UI：`verify-asset-card-ui.mjs`（或新建）断言 `data-cap-model-select` 在 asset 选中时出现；Playwright 选手选项后 mock 或 dryRun 请求体含 `modelKey`（若已有 asset-card 验收则扩展）。

## Risks / Trade-offs

- **[Risk] 手选全局导致「这张卡想用 A、那张想用 B」** → 接受；文档与规格写明；日后 per-card 另变更。  
- **[Risk] 与未归档的 `asset-card-image-audio` 主规格重复** → 归档时合并 `asset-card-generation` Purpose/需求。  
- **[Risk] 音频下拉列出未接入音乐模型** → `isRunnableModel` 已过滤；未接入若仍可见则生成前 `audioModelReady` 拦截（规格已覆盖）。

## Migration Plan

无数据迁移。发布后即生效；旧 localStorage 无 `audio` 键的用户获得 defaults 回落。

## Open Questions

无（设定卡 per-card 模型明确排除在本变更外）。