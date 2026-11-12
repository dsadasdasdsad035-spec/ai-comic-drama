# Design

## Context

- 前端是 Vite + React 18 + TypeScript，样式以 `src/theme.css` 手写 token 为主，另有 Tailwind v4；没有路由库。
- `src/App.tsx` 约 4500 行，用 state 切换 `view`，顶栏、项目/集选择、生命周期弹窗、五个视图的编排都在这里；画布与各视图内部另有独立组件。
- 项目列表来自 `GET /api/project`（`server/db.mjs` 的 `listProjects`），字段只有 `title/style/aspect/episodes/shots/seconds/updated_at`；首帧图存在 `shots.keyframe`，锚点缺口由 `src/promptAudit.ts` 的纯函数计算。
- 创意会话存在浏览器 `localStorage`（`src/creative/sessionStore.ts`），当前没有项目字段。
- API 跑在 Vite 的 `configureServer` 里（Docker 镜像也以 `vite` 启动），服务端代码是 `server/*.mjs` 与 `vite.config.ts`。
- 现有验收脚本直接查 `.topbar` / `.viewtabs`（`verify-theme.mjs`、`verify-creative-ui.mjs`、`verify-publish-ui.mjs` 等），外壳改动必须考虑兼容或迁移。

## Goals / Non-Goals

**Goals:**

- 外壳结构变成「左栏 + 头部 + 视图工具条 + 内容」，且左栏在所有视图保持同一位置。
- 项目成为唯一入口：大厅 → 工作区，返回键回到大厅，打开项目恢复上次视图。
- 大厅卡片有真实的风险状态，不靠前端 N+1 请求。
- 左栏折叠可键盘操作、可记忆，画布在窄宽度自动让出空间。
- 五个既有视图组件、生成与计费逻辑零改动。

**Non-Goals:**

- 不引入 react-router 等路由库。
- 不新增发布视图、剧本视图或全局搜索（⌘K）。
- 不支持项目重命名（当前 API 没有重命名能力），大厅卡片菜单只提供打开、制作参数、删除。
- 不从压缩包直接新建项目。
- 不重写视图内部的 `WorkbenchBar`、Inspector、时间线与聊天面板。

## Decisions

### 1. 用 30 行 hash 路由替代路由库

`#/` 表示大厅，`#/p/<项目名>/<view>` 表示工作区视图。`AppShell` 解析 `location.hash`，监听 `hashchange`；未知路径回落大厅，未知视图回落到概览。

- 理由：只需要两级导航和返回键，引入 react-router 会带来依赖、basename 与部署路径问题。
- 备选：纯 state 切换（返回键失效，放弃）；react-router（收益不值依赖成本，放弃）。
- 细节：程序化导航统一 `history.pushState` + 手动派发事件，避免重复 push 相同 hash；视图白名单来自导航配置，`prompts`/`table` 不在白名单。

### 2. 外壳抽取以「插槽」为边界

`AppShell` 只接收外壳需要的数据，视图仍由 `App.tsx` 渲染为 `children`：

```
<AppShell
  route, view, onNavigate, onOpenProject, onReturnHub,
  project, episodes, epNo, onPickEpisode,
  globalActions, viewBar
>
  {当前视图}
</AppShell>
```

- 理由：`App.tsx` 的业务状态（节点、镜头、Agent、计费）不动，外壳组件保持无业务依赖，后续可单独测试。
- 备选：把全部状态搬进 `AppShell`（改动面翻倍，放弃）；全局 context（调试成本高，放弃）。
- 兼容：头部继续用 `.topbar`，左栏导航容器同时挂 `.viewtabs`（或 `data-viewtabs` 兼容选择器），把验收脚本的改动压到最小。

### 3. 导航配置驱动左栏与路由白名单

单一 `NAV_ITEMS` 配置：`{ id, label, group, icon, countKey? }`，左栏、路由白名单、快捷键顺序都读它。分组为「概览 / 创作（创意、角色、素材、画布）/ 系统（设置）」。

- 理由：避免左栏、路由、测试三处各写一份列表。
- 兼容：`view` 类型不变（`board | chars | assets | settings | creative`），只在最前面加 `overview`。

### 4. 折叠优先级：手动 > 自动

- 持久化键 `sb.railCollapsed`，只在用户手动切换时写入。
- 自动规则：`view === 'canvas'` 且内容可用宽度 < 1400px 时折叠，但不覆盖手动状态；用户手动展开后，本视图内不再自动折叠。
- 折叠宽度通过 `.app` 上的 CSS 变量 `--rail-w` 驱动，左栏、头部、内容同源过渡，200ms。
- 理由：画布最需要空间，但用户一旦表达偏好就不该被自动逻辑覆盖。
- 备选：纯 CSS 媒体查询（无法记忆、无法键盘操作，放弃）。

### 5. 大厅健康数据放在服务端，一次算完

扩展 `GET /api/project` 的列表响应，每项增加：

- `cover`：该项目第一张 `shots.keyframe`（按 `episode, no` 取第一条非空）。
- `health.missing_keyframe` / `health.missing_anchor` / `health.empty`：在 `server/db.mjs` 里按项目批量取 `shots` 与 `characters`，复用同一份锚点审计纯函数。

实现方式：把 `src/promptAudit.ts` 里无框架依赖的 `auditKeyframePrompt` 抽成 `src/promptAuditCore.mjs`（纯 JS + JSDoc），`src/promptAudit.ts` 改为再导出；`server/db.mjs` 直接 import 这个 `.mjs`。

- 理由：卡片徽标在首屏就要显示，浏览器逐项目拉详情会 N+1；服务端一次遍历只多两个查询。
- 备选：前端 `IntersectionObserver` 懒加载详情（首屏抖动、请求数不可控，放弃）；只在卡片上显示「空项目/损坏」（不满足 spec 的缺首帧/缺锚点徽标，放弃）。
- 风险控制：项目数或镜头量过大时给健康计算加一次短 TTL 缓存（仅内存，60s），列表读取不阻塞删除/写入。

### 6. 上次视图按项目存 localStorage

键 `sb.lastView.<项目名>`，值为视图 id。打开项目时读取：白名单内则跳转，否则 `overview`；删除项目时清除该键；项目列表加载时顺手清理已不存在项目的键，避免无限增长。

- 理由：无需改服务端项目表；单机工具足够。
- 备选：写进 `project.json`（会触发项目写入与同步逻辑，放弃）。

### 7. 创意会话加项目字段，未绑定会话只读

`sessionStore` 的会话结构增加 `project?: string`，读取时做一次内存迁移：`project` 缺失的会话保持未绑定，不猜测项目。会话列表按 `project === 当前项目` 过滤；未绑定会话收在单独分组，打开后头部显示「未绑定」，发送入口禁用，直到用户点「绑定到当前项目」写入 `project`。

- 理由：历史数据没有项目信息，猜错会把产物写进错误项目；显式绑定是可逆的最小代价。
- 备选：首次打开全部归入当前项目（可能污染项目数据，放弃）；直接隐藏未绑定会话（数据不可达，放弃）。
- 存储版本：`sessionStore` 增加 `schemaVersion`，迁移只在读时补字段，不批量重写，降低丢数据风险。

### 8. 头部复用现有能力，只换容器

`EpPicker`、`ThemeToggle`、`TaskCenter`、导出按钮、`new-project` / `manage-project` 弹窗全部复用。项目选择器与「项目 ▾」从头部移除，项目菜单改为左栏项目块的弹层（复用 `ProjectMenu` 的点击外部/Esc/焦点归还逻辑）。

- 理由：这些组件已有可访问性与弹层规则，重写只会引入回归。
- 兼容：`data-project-menu` 等测试钩子保留在左栏菜单上。

### 9. 主题与 token 沿用现有约束

新增 `--rail-w`、`--rail-w-collapsed`、`--header-h`，两套主题各写一次字面值；禁止 `--x: var(--x)`。左栏用 `--chrome-1`，激活项用 `--accent-dim` + 2px accent 边条，hover 用 `--panel-2`。

- 理由：与 `STYLE-GUIDE.md` 的「表面 4 级 / 上沿 3 个」体系一致，日夜主题不用另起色板。

## Risks / Trade-offs

- [外壳抽取把 4500 行 App 改出回归] → 外壳只搬 JSX 与导航状态，业务 props 原样透传；每个阶段单独提交并跑现有验收。
- [大厅健康计算拖慢列表] → 批量查询 + 60s 内存缓存；健康计算失败时降级为不显示徽标，不阻塞列表。
- [`.viewtabs` 迁移不彻底导致验收脚本误报] → 左栏导航容器保留兼容选择器，先跑一遍 `verify-theme` / `verify-creative-ui` 再改脚本断言。
- [画布在 1280×800 下仍显得窄] → 折叠后内容宽 1216px；检查小地图、Inspector 与浮动工具条的左偏移，必要时折叠宽度降到 56px。
- [创意四栏在 1280 宽下挤压正文] → 1280 以下自动折叠产物栏，1100 以下会话列表转覆盖层，保证对话列 ≥ 560px。
- [未绑定会话被误写进项目] → 绑定前禁用发送，产物提升入口同时禁用；绑定是显式动作并写审计提示。

## Migration Plan

1. 阶段 0：抽 `promptAuditCore.mjs`，`server/db.mjs` 列表响应加 `cover` / `health`；不改 UI，跑现有验收确认无回归。
2. 阶段 1：新增 `AppShell` / `SideNav` 与 hash 路由，头部换成面包屑 + 集 + 全局工具，五个视图原样挂载；保留 `.topbar` / `.viewtabs` 兼容选择器。
3. 阶段 2：新增项目大厅与「上次视图」，启动落大厅，左栏项目块菜单接通切换/管理/返回大厅。
4. 阶段 3：新增概览页与主操作状态机。
5. 阶段 4：创意的项目绑定、会话字段迁移、未绑定分组与四栏宽度。
6. 阶段 5：更新 `verify-theme`、`verify-creative-ui`、新增 shell/hub 验收，归档 spec。

回滚：每个阶段独立提交，可用 `git revert` 单独撤销；旧代码忽略新增 localStorage 键，新代码在键缺失时使用默认值，不存在数据迁移不可逆点。

## Open Questions

- 大厅卡片封面在首帧缺失时用风格色块还是项目画幅占位图，属于视觉细节，可在实现时按主题对比度决定。
