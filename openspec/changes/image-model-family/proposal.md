# Proposal

## Why

生图能选哪些模型，取决于模型条目往 `caps` 里声明了什么，而 `image`（设定图 / 画布首帧）与 `view`（三视图 / 表情总图）被当成两种能力。默认目录里同一模型因此被拆成两行（`ark-image` 与 `ark-view` 都是 Seedream 4.5，`ark-plan-image` 与 `ark-plan-view` 都是 Seedream 5.0 Pro），两边下拉互不可见；`openai-image`（gpt-image-1）则永远进不了三视图。

但服务端对这两个 cap 的处理完全一致：只影响用哪个默认位、报错文案，以及存图子目录（`char/` 还是 `design/`）。同一模型换个 key 跑的是同一份代码同一张图。于是现状是「同一个能力被切成两份名单」，用户在场景/道具、角色三视图、画布首帧三处都选不到全部可用的生图模型。

## What Changes

- 把「能否生图」收成一个能力：模型只要声明了 `image` 或 `view` 任一，就同时出现在两个位置的可选列表里，双向成立。生图家族是对「一个渠道不支持某能力时不得出现在该能力列表」的**有意例外**，只适用于 image/view，不扩散到 text/video/audio。
- 保留 `defaults.image` 与 `defaults.view` 两个独立默认位：默认值仍可分别指向不同模型，未手选时行为不变。
- 修复素材板在生成前用 `m.cap === 'image'` 硬过滤的问题：它比下拉更严，会出现「下拉里选得到、点生成却报没有可用图像模型」。
- 下拉里按 `provider + modelId` 去重：同一模型的多行只显示一条，保留与当前能力匹配的那一行并写入它的 key；目录条目与存量 `defaults` 不动，不需要迁移。
- 选中的模型不支持参考图时改为**明确失败**：三视图与表情总图依赖参考图维持长相一致，静默丢弃会让用户拿到「不是这个人」的图却以为成功。
- 同步校正验证脚本里按 `cap === 'view'` 取模型的夹具假设，以及「旧图像条目不自动承接三视图」这条与新语义相反的断言。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `model-provider-routing`: 「按能力显式路由且不做自动回退」中的选择列表规则要加生图家族例外，并新增一条「生图请求必须遵守模型对参考图的支持能力，不得静默丢弃」的要求。

## Impact

- 代码：`src/modelCaps.ts`（生图家族谓词）、`src/ModelSelect.tsx`（下拉列表与去重）、`src/AssetBoard.tsx`（生成前预过滤）、`src/settings/hubs/pipeline/RoutingPane.tsx` 与 `src/settings/useSettingsWorkbench.tsx`（默认位可选列表与失效校验）、`src/creative/tools.ts`（创意会话生图解析）、`server/app.ts`（`pickModel` 的图像族解析与参考图拒绝）。
- 数据：`ModelEntry` 结构不变，`defaults.image` / `defaults.view` 不变，无迁移；目录里重复的两行保留，用户删过预设不会被加回来。
- 测试：`verify-model-caps.mjs` 的旧图像断言需改成本意相反的断言；`verify-stage-models-ui.mjs` 等按 `cap === 'view'` 取夹具的脚本改为取生图家族；新增或扩展现有脚本覆盖「同一模型在两个下拉都出现」与「参考图不支持时报错」。
