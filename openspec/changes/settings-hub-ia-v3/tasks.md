# Tasks

## 1. 导航模型与映射

- [x] 1.1 新增 `src/settings/settingsNav.ts`：定义 `SettingsHub`、`SettingsPane`、`HUB_PANES`、`HUB_COPY`、`LEGACY_SECTION_TO_NAV`，并导出类型；单元或简单脚本断言 14 个 legacy id 均有映射
- [x] 1.2 在 `SettingsPage.tsx` 将 `section` 状态改为 `hub` + `pane`，默认 `connections` + `providers`；`initialSection` effect 走映射表；验证手动进入设置仍落渠道页

## 2. 外壳 UI（P0）

- [x] 2.1 重写 `.st-nav` 为五个枢纽按钮，附加 `data-settings-hub`；移除「高级」分隔与 11 项扁平列表；渠道/模型计数仅在连接枢纽相关 pane 或导航上展示
- [x] 2.2 实现 `.st-subnav` 二级 Tab（按 `HUB_PANES` 渲染），`data-settings-pane` 与 `aria-selected`；数据枢纽无 subnav 时直接渲染内容
- [x] 2.3 顶栏使用 `HUB_COPY` 动态主标题与副标题；保留 `dirty` / 保存按钮行为
- [x] 2.4 更新状态条芯片点击：`hub+pane` 跳转；验证缺 Key、失效默认两条路径
- [x] 2.5 在 `theme.css` 增加 subnav、枢纽激活态与窄屏横滑样式；人工在 375px 与 1600px 各验证一次导航可切换

## 3. 内容挂载与深链

- [x] 3.1 将 `st-scroll` 条件渲染改为 `pane` 驱动（与现 `render*` 一一对应）；`stock` 仅在 `extensions` + `stock` 出现
- [x] 3.2 验证 `App.tsx` 深链：`skills`（市场子视图）、`mcp`、`experts` 无需改调用方即可落到正确 hub+pane
- [x] 3.3 各 `render*` 根 `section` 增加与 pane 一致的 `data-settings-pane`

## 4. 管线预览与扩展总览（P1）

- [x] 4.1 实现 `PipelinePreviewCard.tsx` 并在 `renderRouting` 顶部挂载；改默认路由草稿时预览同步更新
- [x] 4.2 实现 `ExtensionsOverview.tsx`（`pane === 'overview'`）：摘要卡片跳转 agent/creative/skills/mcp/experts/stock；验证从创意「打开技能」仍直达技能 pane

## 5. 验收

- [x] 5.1 更新 `verify-settings-ui-v2.mjs` 使用 `data-settings-hub` / `data-settings-pane`；运行 `APP_URL=... node verify-settings-ui-v2.mjs` 全绿
- [x] 5.2 增补用例：切换费用枢纽计价 Tab、扩展总览 → 技能 Tab、深链 `experts`（可选 playwright 片段）

## 6. 重构（可选，P2）

- [x] 6.1 将各 `render*` 迁至 `src/settings/hubs/<hub>/` 或按 pane 分文件，`SettingsPage` 只保留状态与 save/load；`npm run build` 或现有前端 build 通过