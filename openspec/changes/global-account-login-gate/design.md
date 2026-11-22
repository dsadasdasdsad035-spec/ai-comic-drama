# Design

## Context

动机见 proposal.md。实现相关的现状约束：

- 路由是手写的两级 hash 解析（`src/shell/route.ts`），`Route` 只有 `hub` 与 `project` 两种；`route` 是 App 的 state，`sync()` 从 `window.location.hash` 重新解析。
- 所有视图切换都收敛到 `changeView`（5 处调用），但**大厅点项目走的是 `openProject` → `navigate`**，不经过 `changeView`。只拦 `changeView` 会漏掉最主要的一条入口。
- `nav.ts` 是侧栏、路由白名单、快捷键的唯一清单，`account` 目前既是 `ViewId` 也是侧栏分组。
- `useBillingAccount` 是页面级 hook：一进页面就并行拉 `packs`/`ledger`，管理员还会多拉三项。它不适合被提升到 App 层做登录态。
- `/api/auth/me` 对未登录返回 200 + `user: null`；接口不可用才抛错。因此「未登录」与「后端挂了」天然可分。
- `/api/billing/settings` 需要管理员权限，前端没有任何途径读到 `billing_enabled`。
- 服务端已有按需闸门（`server/billing/guard.mjs`）：只有 `apimart + 平台 Key` 才要求登录，BYOK 直接放行。

## Goals / Non-Goals

**Goals:**
- 账号页成为与项目大厅同级的全局视图，未登录时它就是登录页。
- 计费开启时，未登录无法通过任何入口进入项目视图（菜单点击、大厅点项目、手输 URL、刷新、浏览器前进后退）。
- 登录成功后回到被拦前想去的视图。
- 计费关闭时前端完全不拦，与服务端 `skipBilling` 保持一致。

**Non-Goals:**
- 不改服务端的扣费与闸门逻辑（`guard.mjs` 一行不动）。
- 不改充值、流水、管理员面板的内部行为。
- 不引入路由库，不把 hash 路由换成 history 路由。
- 不做「游客试用」「匿名项目」之类的中间态。

## Decisions

### 决策 1：闸门放在「路由生效前」，用渲染期派生而不是 effect 拦截

**做法**：`route` 解析完成后立即派生一个 `effectiveRoute`：若命中闸门则返回账号页路由，否则原样。渲染与下游所有逻辑（项目水合、视图切换）都读 `effectiveRoute`。

**为什么不用 effect 里 `navigate()` 回退**：effect 回退会先渲染一帧目标视图、触发项目加载与画布水合，再跳走。用户会看到画布闪一下，且白跑一轮项目请求。派生路由是同步的，目标视图从未挂载。

**代价**：URL 与实际视图会短暂不一致（地址栏仍是 `#/p/x/board`，界面是账号页）。用 `replaceState` 把地址改成 `#/account?next=...` 补齐，历史上不留一条死链。

**替代方案**：
- 在 `changeView` / `openProject` 各加一次判断 —— 入口太多，深链接和浏览器返回仍会漏，否决。
- 守卫组件包住 `AppShell` 子节点 —— 子组件仍会挂载，同样白跑请求，否决。

### 决策 2：登录态用独立轻量 hook，不复用 `useBillingAccount`

新增 `useSession()`，只调 `/api/auth/me`，返回 `{ user, billingEnabled, loading, refresh, setUser }`。

**为什么**：`useBillingAccount` 会连带拉充值档位、流水、管理员配置；闸门只需知道「有没有会话」，把这些请求绑到每次进应用上是浪费，也会让未登录用户触发 401 噪音。

**替代方案**：把 `useBillingAccount` 提升为 Context 单例 —— 改动面大，且账号页仍需要它自己的 `busy`/轮询状态，共享会互相干扰，否决。

三态必须区分：`loading`（探测中）、`anonymous`（确定未登录）、`authenticated`。`loading` 期间 MUST NOT 跳转，否则已登录用户每次刷新都会闪一下登录页。

### 决策 3：`billingEnabled` 由 `/api/auth/me` 附带，而不是新开接口

响应加一个字段，复用既有 `isBillingEnabled()`。不新增端点：这个值必须与 `user` 在同一次请求里取到，否则会出现「读到 user 但开关还是旧值」的竞态。

未登录也返回该字段（它不含敏感信息，只表示部署形态）。

### 决策 4：`account` 从 `ViewId` 中移除，另立路由变体

`Route` 增加 `{ kind: 'account'; next?: string }`。`parseHash` 识别 `#/account`，并解析 `?next=`。

**兼容**：`#/p/<项目>/account` 在 `parseHash` 里直接归一成账号路由（不经过「未知视图回落概览」），这样历史书签与旧链接行为正确。

**为什么不保留 `account` 作为 `ViewId`**：`ViewId` 的语义是「项目视图」，账号页不属于任何项目；保留它会让 `AppShell` 的侧栏、集选择器、面包屑都要对账号页做特例判断。移除后 `view === 'account'` 这个分支从 `AppShell` 里消失，改为顶层并列渲染。

### 决策 5：`next` 用 hash 内查询参数承载

形式 `#/account?next=<encodeURIComponent(原 hash)>`。

**为什么不用 sessionStorage**：链接可分享、可刷新、可用浏览器后退；也避免「上次残留的 next 把用户带到莫名其妙的地方」。`next` 只在本次导航有效，登录后即用即弃。

**校验**：`next` 必须是以 `#/p/` 开头的合法项目路由才采纳，否则回落大厅。防止被构造出跳去外部地址或死循环。

### 决策 6：账号页未登录态独立整屏，不吃 `AppShell`

未登录时左栏所有项目菜单都点不了，留着外壳只提供误导性入口。账号页因此绕开 `AppShell`，自己渲染整屏：品牌标 + 登录卡（`AuthPanel` 原样复用）。

已登录时同样走整屏，用与账号页现有 `st-shell` 一致的容器，而不是塞回项目工作区。

### 决策 7：闸门白名单只放 `settings`

`EXEMPT_VIEWS = ['settings']`。理由：设置里是本地 API Key、模型配置、项目导入导出，属配置能力，不产生平台消费；拦它会让未登录用户连 Key 都填不了，而填 Key 恰恰是 BYOK 免登录路径的前提。

账号页本身不参与判断（它是闸门的落点，不会自我重定向）。

## Risks / Trade-offs

- **[地址栏与视图短暂不一致]** → 用 `replaceState` 在进入账号页时同步 URL；`next` 参数保留原目标，刷新后仍能正确回跳。
- **[`billingEnabled` 变更后前端不刷新]** → 该值在会话探测时取；管理员切换开关后，用户下次刷新或重新登录时生效。可接受：这是部署形态，不是运行期高频切换项。
- **[已登录用户被踢]** → 会话过期后首次进入项目视图会被导向账号页，用户手头操作丢失。缓解：`402`/`401` 的既有错误文案已提示去账号页登录；不做「静默续期」。
- **[后端不可用时被误判为未登录]** → `/api/auth/me` 抛错时 `useSession` 保持 `loading` 而非 `anonymous`，闸门不跳转，页面显示读取失败提示。这是刻意选择：宁可放行也不要把「服务挂了」渲染成「请登录」。
- **[移除 `account` 视图影响既有验收脚本]** → 现有脚本若断言侧栏含账号项会失败。实现时先搜 `account` 相关断言并同步。
- **[充值页依赖项目上下文]** → 充值本身不需要项目，但现有 `AccountPage` 用了 `settings-shell` 样式类。提出时已确认可脱离项目外壳独立渲染。

## Migration Plan

1. 服务端先加 `billingEnabled` 字段（向后兼容，老前端忽略该字段）。
2. 前端路由与 `useSession` 就位，闸门默认跟随 `billingEnabled`（默认 false 时不拦），因此部署后行为不变。
3. 移除侧栏账号项，同时上线大厅账号入口与 `#/account`。
4. 运维确认无误后打开 `billing_enabled`，闸门随之生效。

回滚：把 `billing_enabled` 关掉即可让闸门整体失效，无需回滚代码。
