# Proposal

## Why

角色已经有「从本集/全剧拆角色 → 生成三视图 → 上画布 → 镜头参考」的完整链路，但场景和道具仍然只能靠画布上的「+ 素材」手工建卡、手写提示词。结果是同一个场景在不同镜头里反复描述、同一件关键道具每次长相不同；拆角色时积累的规则（场景要素、空镜、多角度设定图）也没有进入设置页，无法复用或调整。

## What Changes

- 设置页新增第五个「技能规则包」：**素材守则**，默认启用、可直接编辑；内容覆盖场景按地点去重、场景图空镜、道具只拆关键道具、道具多角度参考表、锚点逐字复用。
- 设置页新增第五个生成环节 **素材（拆场景/道具）**，可选择文本模型；未绑定沿用「文本 · 常规」默认。旧设置通过 `normalizeRules` 自动补齐，不需要迁移。
- 新增顶级「素材」页，内部两个页签：**场景 / 道具**。支持「从本集拆」和「从全剧拆」，从当前项目的分集场次与镜头摘要中提取可复用的场景和关键道具。
- 场景/道具以结构化的 **DesignSheet** 保存：名称、关联镜号、中文摘要、英文生图锚点、关键词、图片与候选图。同一地点/道具重复出现时合并为一张卡，保留已有手改内容。
- 场景图按「空镜 + 统一画风锁 + 16:9」生成；道具图按「多角度参考表 + 中性背景 + 无手无人物」生成；两者都支持 2 张候选。
- 拆出的图可以按卡「加入画布」，也可以「全部加入画布」。加入后成为现有 `scene` / `prop` 素材卡，可继续用现有连线与多参考图逻辑服务镜头首帧；按 `designId` 幂等，重复加入只更新不重复建卡。
- **BREAKING**（仅内部数据接口）：项目数据新增 `designs`；素材记录新增 `designId`；`/api/project` 接受 `designs` 字段；SQLite 新增 `designs` 表并给 `assets` 补 `design_id` 列。
- 明确不做：布局图/场景平面图；单镜构图继续由现有 3D 调度承担；不新增 `layout` 素材类型。

## Capabilities

### New Capabilities

- `scene-prop-design`: 场景/道具的可配置拆解规则、环节模型、项目级设定卡、分集/全剧提取、场景空镜与道具参考图生成。
- `asset-canvas-publishing`: 把场景/道具设定卡按单卡或批量发布到画布，幂等更新，并作为现有镜头参考图使用。

### Modified Capabilities

无。

## Impact

- 代码：`src/Settings.tsx`（素材守则与素材环节）、`src/api.ts`（Stage / ProjectData / ProjectAsset / DesignSheet）、`src/knowledge.ts`（ASSET_RULES 默认值）、`src/prompts.ts`（素材系统提示词）、`src/App.tsx`（素材视图、推送与画布卡）、新增 `src/AssetBoard.tsx` / `src/designExtract.ts`、`src/data.ts` / `src/types.ts`（素材卡 designId）、`server/db.mjs`（designs 表与 assets 列）。
- 数据：SQLite 新增 `designs` 表；`assets` 增加可选 `design_id`；项目 API 增加 `designs`；设置只通过 `normalizeRules` 补默认，无 schema 迁移；画布素材卡仍按项目 localStorage 保存布局。
- 验证：设置默认值与旧设置合并、项目隔离、提取合并、单卡/批量幂等推送、素材卡参与镜头参考、构建与现有脚本回归。
- 兼容性：现有素材卡没有 `designId` 时按普通素材继续工作；现有设置没有 `asset` 规则/环节时自动使用默认；3D 调度和出片链路不变。
