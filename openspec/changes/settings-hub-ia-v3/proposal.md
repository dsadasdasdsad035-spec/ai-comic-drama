# Proposal

## Why

设置页 2.0 已具备侧栏分组与状态条，但 14 个扁平分区把「连接、管线、扩展、费用、数据」混在一个「高级」桶里，顶栏语境固定为「渠道、模型与默认路由」，从创意工作室等入口跳进技能/MCP 时缺少任务导向的导航。用户要完成「接通 API → 定默认 → 装扩展 → 管钱包」需要在技术名词间来回找，认知负荷高。

## What Changes

- 将设置导航重组为 **五个一级枢纽**：连接与模型、制作管线、智能与扩展、费用、数据；枢纽内用 **二级 Tab** 承载现有 14 个功能块（内容逻辑与保存模型不变）。
- 顶栏标题与副标题 **随当前枢纽变化**；健康状态条芯片 **可点击跳转** 到对应枢纽与子 Tab（缺 Key → 连接·渠道；失效默认 → 管线·默认路由）。
- **制作管线 · 默认路由** 增加只读 **管线预览卡**（拆镜/出图/出片/配音摘要），其下保留 Cap 与环节两级路由。
- **智能与扩展** 增加 **总览** 子页（Agent/扩展数量摘要 + 链到子 Tab）；技能/MCP/专家保留现有面板，**素材库** 作为扩展枢纽内独立子 Tab（与创意配置相邻，不并入制作管线）。
- **费用** 合并计价与账户充值为同一枢纽下的两个 Tab。
- 保留 **`SettingsInitialSection` 深链** 与 `changeView('settings', { settingsSection })` 行为，内部映射到 `hub + pane`。
- 验收：`verify-settings-ui-v2.mjs` 改用 `data-settings-hub` / `data-settings-pane`（或等价 role）选择器，减少对侧栏文案的硬编码。
- **不改动**：`AppSettings` 字段、保存 API、各分区表单字段与业务校验；主题切换仍在全局顶栏，不在本次新增「外观」分区。

## Capabilities

### New Capabilities

- `settings-workbench`：设置视图的五枢纽信息架构、二级 Tab、动态顶栏、状态条跳转、深链兼容、窄屏导航与管线预览等可观测 UI 行为。

### Modified Capabilities

- （无）外壳与工作台其他视图契约不变；设置页仍不显示空的视图上下文带。

## Impact

- 代码：`src/settings/SettingsPage.tsx`（导航状态与布局）、`src/theme.css`（`.st-nav` / 枢纽样式 / 二级 Tab）、可选拆分为 `src/settings/hubs/*`；`src/Settings.tsx` 类型导出保持兼容。
- 调用方：`src/App.tsx` 的 `settingsSection` 深链；创意工作室 `onOpenAllSkills` / `onOpenMcp` / `onOpenExperts`。
- 验收：`verify-settings-ui-v2.mjs` 更新选择器；可增补枢纽切换与深链用例。
- 不在本次范围：全设置搜索（P3）、按分区自动保存、OpenSpec 外的新计费规则。