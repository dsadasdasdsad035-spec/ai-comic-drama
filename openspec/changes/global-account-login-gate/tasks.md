# Tasks

## 1. 服务端：计费开关对客户端可见

- [x] 1.1 在 `server/billing/http.mjs` 的 `/api/auth/me` 响应里加 `billingEnabled: isBillingEnabled()`（未登录分支也要带）；用 `curl -s localhost:<port>/api/auth/me | grep billingEnabled` 确认未登录时字段存在且为 `false`
- [x] 1.2 确认 `isBillingEnabled` 已从 `./settings.mjs` 导入到该路由模块（缺则补 import），并用 `node --check server/billing/http.mjs` 验证语法

## 2. 路由：账号页升为全局视图

- [x] 2.1 `src/shell/route.ts` 的 `Route` 增加 `{ kind: 'account'; next?: string }`，`parseHash` 识别 `#/account` 并解析 `next` 查询参数；新增 `accountHash(next?)` 构造器，验证：在 `parseHash` 上用 `#/account`、`#/account?next=%23%2Fp%2Fa%2Fboard` 两种输入断言返回对应路由
- [x] 2.2 `parseHash` 把 `#/p/<项目>/account` 归一成账号路由（不得落到「未知视图回落概览」）；验证：同一纯函数断言该输入返回 `kind: 'account'`
- [x] 2.3 `next` 采纳前校验：必须以 `#/p/` 开头且能解析成合法项目路由，否则丢弃；验证：断言 `next=%23%2Fevil.com` 与 `next=%23%252F` 这类输入回落为无 next 的账号路由

## 3. 导航：账号入口从侧栏移到大厅

- [x] 3.1 `src/shell/nav.ts` 移除 `account` 导航项与 `account` 分组，`ViewId` 去掉 `'account'`；验证：`npx tsc --noEmit` 通过（`ViewId` 收缩后会暴露所有残留引用）
- [x] 3.2 `src/App.tsx` 移除 `view === 'account'` 的 `AppShell` 内分支，改为顶层与 `hub` 并列渲染账号页；验证：`npx tsc --noEmit` 通过，且手动打开 `#/account` 看到账号页而非项目外壳
- [x] 3.3 `src/shell/ProjectHub.tsx` 顶栏在 `themeToggle` 旁加账号入口（未登录显示「登录」，已登录显示邮箱），点击导航到 `#/account`；验证：未登录时大厅顶栏出现「登录」，点击后落在账号页

## 4. 登录态：轻量会话 hook

- [x] 4.1 新增 `src/account/useSession.ts`：只调 `/api/auth/me`，返回 `{ user, billingEnabled, status, refresh, setUser }`，`status` 三态 `loading | anonymous | authenticated`；验证：`useBillingAccount` 未被改动，且该 hook 的请求只有一条（浏览器网络面板确认进应用只打一次 `/api/auth/me`）
- [x] 4.2 探测失败（抛错）时保持 `loading` 而非 `anonymous`，并在界面给出可重试提示；验证：用 Playwright 拦截 `/api/auth/me` 返回 500，断言不跳转到账号页
- [x] 4.3 `useBillingAccount` 的 `refresh()` 成功后回写 `useSession` 的 `user`，避免登录后闸门仍拿着旧值；验证：登录成功后不刷新页面即可进入画布

## 5. 闸门

- [x] 5.1 `src/App.tsx` 实现 `effectiveRoute` 派生：`billingEnabled && !user && route.kind === 'project' && view !== 'settings'` 时返回账号路由（`next` = 原目标 hash）；验证：纯函数化后单测断言六种组合（计费开关 × 登录态 × 是否设置页）
- [x] 5.2 `loading` 态不跳转；验证：清空 cookie 后刷新页面，断言首帧不出现登录页闪烁（Playwright 截图对比或断言 `#/account` 仅在探测完成后出现）
- [x] 5.3 进入账号页时用 `replaceState` 把地址同步为 `#/account?next=...`；验证：从 `#/p/x/board` 被拦后，地址栏为 `#/account?next=%23%2Fp%2Fx%2Fboard`，且浏览器后退不会回到被拦的 board
- [x] 5.4 覆盖四条入口：侧栏菜单点击、大厅点项目、手输深链接、浏览器前进后退；验证：新增 `verify-login-gate.mjs`，四条入口逐一断言最终落在账号页（前三条）+ 后退不再进入受保护视图

## 6. 账号页与回跳

- [x] 6.1 `src/account/AccountPage.tsx` 拆出未登录整屏形态（独立于 `AppShell`，品牌标 + `AuthPanel` 居中），已登录仍渲染钱包/充值/流水/管理员；验证：未登录打开 `#/account` 无侧栏、无项目名、无集选择器
- [x] 6.2 `AuthPanel` 登录成功后按 `next` 回跳，无 `next` 回大厅；验证：带 `next` 登录后落在目标视图，不带时落在 `#/`
- [x] 6.3 `next` 指向已删除项目时回落大厅而非白屏；验证：构造 `next` 指向不存在项目，登录后断言落在大厅
- [x] 6.4 充值流程回归：登录后在账号页发起充值仍能打开支付页并轮询到账；验证：复用既有充值 mock，断言 `startRecharge` 与轮询行为未变
- [x] 6.5 账号页提供返回项目大厅的入口（独立整屏没有面包屑，未登录/已登录都要能离开）；验证：`verify-login-gate.mjs` 分别断言两种状态点击后落到 `#/`

## 7. 文档与验收收口

- [x] 7.1 更新 `src/api.ts` 里 `login_required` 的提示文案（现在指向「左侧账号与充值」，实际已在大厅顶栏/全局账号页）；验证：grep 确认提示文案不再提到「左侧」
- [x] 7.2 通读 `openspec/specs/user-accounts/spec.md` 与 `workbench-shell/spec.md`，确认新增要求与实现一致；验证：`openspec validate global-account-login-gate --strict` 通过
- [x] 7.3 全量回归：`npx tsc --noEmit` + 既有 `verify-*.mjs` 中路由/导航相关脚本全部通过

## Workflow follow-up

- Archive the change after review, running `openspec archive global-account-login-gate` so the deltas merge into `user-accounts` and `workbench-shell`.
