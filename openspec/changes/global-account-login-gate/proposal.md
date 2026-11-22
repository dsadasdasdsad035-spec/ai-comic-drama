# Proposal

## Why

账号能力已经存在（注册、登录、会话、充值、流水），但入口藏在项目工作区的侧栏里，且没有任何访问控制：未登录用户可以正常打开概览、素材、剧本、画布与创意，一路用到发起平台代调用才被服务端 401 挡住。用户在一长串操作后才遇到「请先登录」，前面填的内容白费；同时「账号与充值」依附于某个具体项目，而账号本身是跨项目的身份，两者层级不匹配。

## What Changes

- **账号页升为全局视图**：`#/account` 脱离项目路径，成为与项目大厅同级的顶层入口。未登录时它就是登录页（独立的登录/注册卡片），登录后是现有的余额、充值、流水与管理员配置。
- **旧链接兼容**：`#/p/<项目>/account` 重定向到 `#/account`。
- **侧栏移除账号项**：`nav.ts` 删除 `account` 视图与对应分组，`ViewId` 不再包含它；项目大厅顶栏新增账号入口（未登录显示「登录」）。
- **新增登录闸门**：除「设置」外，进入任何项目视图前先判断登录态；未登录则跳转 `#/account?next=<原目标>`，登录成功后回到原目标。
- **闸门跟随计费开关**：`billing_enabled` 为 false 时不拦（本地自有 Key 场景与服务端 `billingGuard` 的 `skipBilling` 语义一致），为 true 时全站生效。
- **`/api/auth/me` 增补 `billingEnabled`**：前端目前没有任何途径读到该开关，闸门需要它。
- **BREAKING**：侧栏不再有「账号与充值」菜单；依赖 `#/p/<项目>/account` 的链接被重定向。

## Capabilities

### New Capabilities

无。本次不引入新的系统行为类别——登录闸门属于既有 `user-accounts` 的访问控制语义，账号页位置调整属于既有 `workbench-shell` 的导航分层语义。

### Modified Capabilities

- `user-accounts`: 新增「会话态决定项目视图可达性」的要求：未登录（且计费开启）时项目视图不可达，账号页是其唯一入口；`/api/auth/me` 需回报计费开关，使客户端能在与服务端一致的边界上做判断。
- `workbench-shell`: 账号入口从项目视图侧栏移到项目大厅，`account` 不再是项目级视图；导航清单与 `ViewId` 相应收缩。

## Impact

- `src/shell/route.ts`：`Route` 新增 `account` 变体，`parseHash` 识别 `#/account` 与 `?next=`，旧路径重定向。
- `src/shell/nav.ts`：移除 `account` 视图与 `account` 分组。
- `src/shell/ProjectHub.tsx`：顶栏新增账号入口。
- `src/shell/SideNav.tsx` / `useRail.ts`：分组删减后的渲染不变，无需逻辑改动（读 `NAV_GROUPS`）。
- `src/App.tsx`：`changeView` 与深链接水合两处加闸门；`view === 'account'` 分支移出 `AppShell`。
- `src/account/AccountPage.tsx`：拆出独立的未登录整屏形态；充值/流水/管理员面板不动。
- `src/account/AuthPanel.tsx`：复用，仅补一行说明与登录成功回跳。
- 新增 `src/account/useSession.ts`：App 层单例登录态，只调 `/api/auth/me`。
- `server/billing/http.mjs`：`/api/auth/me` 响应加 `billingEnabled`（复用既有 `isBillingEnabled`）。
- 验收脚本：新增路由/闸门用例；`openspec show workbench-shell` 相关既有断言若涉及侧栏账号项需同步。
