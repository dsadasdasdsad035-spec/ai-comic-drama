# Proposal

## Why

工作台顶部现在叠着三条独立横带：54px 全局顶栏、40px 集栏、各视图自己的工具条（镜头表/提示词 48px，角色/素材还要再加标题行和模型行，合计约 180px）。三条带各自演化，导致同一个事实重复出现（项目在左选择器、右侧文本和工作台条各一次；集在集栏和聊天头部各一次），画布专属工具（标注、操作、+素材、连播）挤进全局顶栏让顶栏成分随视图变化，主强调色被「导出 JSON」占用而非各视图真正的下一步动作，1440–1500 宽时工具条标签还会逐字换行成「项 / 目」「模 / 型」。角色页可以切集维度的镜头内容却没有集入口。

上沿是用户每次操作都要经过的区域，重复信息和位置漂移直接抬高认知成本。这次把三条带合并为固定结构的两条，先把"哪里放什么"定下来，再谈视觉。

## What Changes

- **两条带替代三条带**：Row 1（52px）全局带只放身份、项目、集、7 个视图导航和全局工具；Row 2（44px）上下文带只放当前视图的范围、设置和动作，固定「范围 | 设置 | 动作」三段位。
- **移除整条集栏**：集改为 Row 1 的下拉 chip（`E01 夜雨 · 6 镜`），点开是带镜数的胶囊列表。角色页因此首次获得集切换。
- **移除右侧状态槽**：取消「项目名 / 设置 / 场景 / 道具 / N 个角色」在不同视图下复用同一位置的写法；计数并入 Row 2 的范围区。
- **画布工具内移**：标注、操作、+ 素材、连播从全局顶栏移入画布左上角浮动工具条，Row 1 对七个视图保持同一组成分。
- **角色 / 素材板头部合并**：`.board-head` 与 `.board-models` 合并进 Row 2；说明段落只在空板时以一行可关闭提示出现。
- **主操作归一**：每个视图只保留一个强调色主操作；导出 JSON、主题、任务降为幽灵按钮或菜单项。角色/素材页主按钮随状态切换（空板 → 从本集拆；有未发布设定 → 全部加入画布）。
- **响应式规则显式化**：工具条标签禁止逐字换行，范围文字省略；Row 1 用显式断点（≥1400 全量 / 1280–1400 收品牌与集细节 / <1180 有意折两行）；Row 2 用容器查询响应聊天抽屉造成的列宽变化，弹层走 portal。
- **BREAKING（内部结构）**：`.epbar`、`.board-head`、`.board-models`、顶栏 `.board-count` 不再是稳定结构；依赖 `.epbar-tab` 的两个校验脚本与一批 evidence 截图需要同步更新。

## Capabilities

### New Capabilities

- `workbench-shell`: 全站外壳的分层、导航与视图上下文带。覆盖两条带的职责边界、项目与集的唯一显示位置、视图工具归属、每视图单一主操作、断点与容器查询行为、外壳的可访问性语义。

### Modified Capabilities

- `theme-switching`: 现有要求把「顶栏、集栏」列为必须跟随主题的表面，集栏横带移除后需要改为「全局带、集上下文 chip、上下文带」，并保留日间上沿的表面层级要求。

## Impact

- 前端外壳：`src/App.tsx`（顶栏与视图分支）、`src/EpisodeBar.tsx`（横条改为集选择器）、`src/ToolMenu.tsx`、`src/BoardMenu.tsx`、`src/ShotTable.tsx`、`src/PromptTable.tsx`、`src/ScriptBoard.tsx`、`src/CharacterBoard.tsx`、`src/AssetBoard.tsx`、`src/chat-ui/WorkbenchHeader.tsx`（集/项目重复显示处）。
- 样式：`src/theme.css`（`.topbar`、`.epbar`、`.wb-bar`、`.board-head`、`.board-models`、断点与容器查询），日间主题覆盖层需补上沿表面 token。
- 交互：新增集选择器的键盘与 `aria-haspopup`/`aria-expanded` 语义；视图按钮补 `aria-current="page"`。
- 测试与证据：`verify-3d-render-asset-flow.mjs`、`verify-workbench-chats.mjs` 使用 `.epbar-tab`；`verify-workbench-chat-ui.mjs` 使用 `.wb-foot`/`.wb-field`；`verify-shot-inspector.mjs` 使用 `.board-hint`；已有头部相关 evidence 截图需重拍。
- 不改动：数据模型、项目文件、API、模型路由、聊天运行时与技能契约；`theme-switching` 的存储与首帧应用行为不变。
