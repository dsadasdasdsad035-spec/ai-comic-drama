# Tasks

## 1. 服务端与共享审计

- [x] 1.1 把 `src/promptAudit.ts` 中无框架依赖的审计逻辑抽到 `src/promptAuditCore.mjs`（纯 JS + JSDoc），`src/promptAudit.ts` 改为再导出；验证：`npx tsc --noEmit` 通过，`node verify-prompt-render.mjs` 与 `node verify-transitions-ui.mjs` 结果与改动前一致
- [x] 1.2 在 `server/db.mjs` 的 `listProjects` 响应中增加 `cover`（按集/镜号取第一条非空 `shots.keyframe`）与 `health`（`missing_keyframe`、`missing_anchor`、`empty`），复用 `promptAuditCore.mjs`；验证：启动 dev server 后 `curl -s localhost:5273/api/project | node -e "..."` 能看到每个项目带 `cover` 与 `health`，且原有字段不变
- [x] 1.3 为健康计算加 60 秒内存缓存，健康计算异常时降级为不返回 `health` 且不影响列表；验证：临时在审计调用处抛出错误，请求列表仍 200，其他项目带完整字段

## 2. 外壳骨架

- [x] 2.1 新增 `src/shell/nav.ts`：`NAV_ITEMS`（概览/创意/角色/素材/画布/设置，含分组、图标、计数键）与视图白名单；验证：`npx tsc --noEmit` 通过，`rg -c "NAV_ITEMS =" src` 只有一处定义，白名单断言由 2.3 的脚本覆盖
- [x] 2.2 新增 `src/shell/AppShell.tsx` 与 `SideNav.tsx`，用插槽承载现有五个视图；头部沿用 `.topbar`，左栏导航挂 `.viewtabs` 兼容选择器；验证：`node verify-theme.mjs`、`node verify-chars.mjs`、`node verify-assets.mjs` 全绿
- [x] 2.3 实现 hash 路由（`#/`、`#/p/<name>/<view>`），未知路径回落大厅或概览，重复导航不重复 push；验证：新增 `verify-shell-route.mjs` 覆盖直达链接、非法视图、返回键三步
- [x] 2.4 头部换成「面包屑 + `EpPicker` + 全局工具」，移除 `ProjectSelect` 与「项目 ▾」；`ThemeToggle`、`TaskCenter`、导出保持原位置与行为；验证：`node verify-project.mjs`、`node verify-agent-shell.mjs` 全绿，设置页头部无集选择器
- [x] 2.5 实现左栏折叠：CSS 变量 `--rail-w`、手动状态写入 `sb.railCollapsed`、`[` 快捷键、画布 <1400px 自动折叠且手动优先；验证：新增 `verify-shell-nav.mjs` 断言展开 240 / 折叠 64、键盘切换、画布窄屏自动折叠、手动展开后不再自动折叠
- [x] 2.6 在 `STYLE-GUIDE.md` 补充 `--rail-w` / `--rail-w-collapsed` / `--header-h` 与左栏激活态规范；验证：文档中每个新增 token 与 `theme.css` 实际值一致，`node verify-style.mjs` 通过

## 3. 项目大厅与路由

- [x] 3.1 新增 `src/shell/ProjectHub.tsx`、`ProjectCard.tsx`：封面/占位、标题、风格·画幅、集·镜·秒、更新时间、缺首帧/缺锚点/损坏徽标；验证：新增 `verify-project-hub.mjs` 断言有内容项目与空项目两类卡片
- [x] 3.2 大厅「继续创作（最近 5）」与「全部项目」分区、按更新时间倒序、标题/目录名搜索；验证：`verify-project-hub.mjs` 覆盖搜索过滤与最近项目不重复
- [x] 3.3 大厅空态只显示新建入口，创建成功后刷新列表并在新项目概览打开；验证：`verify-project-hub.mjs` 清空项目目录后断言空态，新建后断言卡片出现
- [x] 3.4 启动始终落 `#/` 大厅；打开项目跳 `#/p/<name>/<lastView>`，无记录落概览；返回大厅不改变项目数据；验证：`verify-shell-route.mjs` 覆盖冷启动、打开、返回、再打开四步
- [x] 3.5 左栏项目块菜单接通最近项目（≤5）、管理项目、返回大厅，复用 `ProjectMenu` 的点击外部/Esc/焦点归还；验证：`verify-shell-nav.mjs` 断言菜单三项、键盘可达、Esc 归还焦点
- [x] 3.6 删除当前项目后返回大厅并清除 `sb.lastView.<项目>`；删除非当前项目留在工作区；验证：`verify-project-lifecycle.mjs` 增补两条断言

## 4. 项目概览

- [x] 4.1 新增 `src/shell/OverviewPage.tsx`：一屏显示集数/镜头数/总时长/缺首帧/缺锚点与集列表（镜数、时长），空项目显示空态；验证：新增 `verify-project-overview.mjs` 断言 KPI 数值与集行
- [x] 4.2 概览主操作状态机：0 镜「导入分镜」、缺首帧「去画布补帧」、就绪「打开画布」，其余入口次级样式；验证：`verify-project-overview.mjs` 三种状态各断言唯一强调按钮
- [x] 4.3 概览集行点击切集并打开画布；验证：`verify-project-overview.mjs` 点 E02 后断言 `epNo` 与画布集摘要

## 5. 创意绑定项目

- [x] 5.1 `src/creative/sessionStore.ts` 会话增加 `project?: string` 与 `schemaVersion`，读取时只在内存补字段、不批量重写；验证：新增 `verify-creative-projects.mjs` 断言旧会话读取后仍可打开且未被改写
- [x] 5.2 会话列表按当前项目过滤，未绑定会话进独立分组；打开未绑定会话显示「未绑定」且禁用发送，绑定后写入 `project` 并移入项目列表；验证：`verify-creative-projects.mjs` 覆盖过滤、禁用、绑定、列表迁移
- [x] 5.3 创意头部显示当前项目与集号；无项目时创意入口不可用并提示先选项目；验证：`verify-creative-projects.mjs` 断言头部上下文与无项目空态
- [x] 5.4 四栏宽度响应：≥1440 四栏、1280–1440 折叠产物、<1100 会话列表覆盖层，对话正文 ≤640px；验证：`node verify-creative-ui.mjs` 增补 1500/1280/1080 三档宽度断言
- [x] 5.5 在 `README.md` 的界面章节补充创意绑定项目与会话迁移说明；验证：按文档步骤清空 `project` 字段后能复现「未绑定」分组

## 6. 集成验收

- [ ] 6.1 把 2.3、2.5、3.1、3.4、4.1、5.1 新增的验收脚本接入 `verify-all.mjs`，补齐缺失入口；验证：`node verify-all.mjs` 通过，且每个新脚本单独运行也通过
- [x] 6.2 迁移 `verify-theme.mjs`、`verify-creative-ui.mjs` 中对旧顶栏 tabs 的位置断言到左栏与头部；`verify-publish-ui.mjs` 随发布台下线一并删除；验证：两个脚本全绿，且不再依赖已删除的头部布局
- [x] 6.3 全量回归：`npx tsc --noEmit`、`node verify-project.mjs`、`node verify-project-lifecycle.mjs`、`node verify-shot-inspector.mjs`、`node verify-transitions-ui.mjs`；验证：全部通过，画布在 1280×800 下折叠后无控件重叠

## Workflow follow-up

- 归档前按项目评审要求跑一遍完整验收，并在真机（本机 1440×900 与 1280×800）确认左栏、头部、画布、创意四栏的视觉结果。
- 归档 `project-hub-sidebar-shell`，确认 `openspec/specs/` 中 `project-hub` 新能力与四个被修改能力的最终文本。
