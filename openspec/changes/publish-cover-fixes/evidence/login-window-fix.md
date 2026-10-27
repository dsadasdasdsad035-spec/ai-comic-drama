# 登录窗口一闪而过：根因与修复

日期：2026-10-26

## 症状

在发布台「平台账号」点连接，浏览器窗口打开后立刻关闭，没有任何扫码机会。

## 根因

`server/publish-browser.mjs` 的兜底登录判定是：

```js
loggedIn = !looksLikeLoginUrl(page.url())   // URL 不含 login/passport/signin/auth 即视为已登录
```

`startLogin` 没有传 `isLoggedIn`，于是每个平台都用这条兜底。抖音创作者后台地址是
`creator.douyin.com/creator-micro/content/upload`，不含任何登录关键字，而登录框是**同一 URL 上的弹层**。
结果第一轮轮询（1 秒后）就判定「登录成功」，`finally` 里 `ctx.close()` 直接关窗。

## 实测证据（本机 Chrome，未登录态）

| 平台 | 实际 URL | 未登录时的 `input[type="file"]` | 认证 cookie |
|---|---|---|---|
| 抖音 | `creator.douyin.com/creator-micro/content/upload`（不含 login） | 0 个 | 只有 `ttwid` / `passport_csrf_token` 等匿名 cookie，无 `sessionid` |
| B 站 | 重定向到 `passport.bilibili.com/login` | 0 个 | 无 `SESSDATA` / `DedeUserID` |

抖音这一行正是旧判定误判的场景：URL 干净、DOM 里没有上传框、也没有登录态 cookie。

## 修复

1. 新增 `adapterLoginProbe(platformId)`：用该平台适配器的 `checkSession` 判定，只有测到真实后台元素（上传框 / 表单框架）才算登录；连续两次确认（默认间隔 1.2 秒）滤掉页面切换的瞬态 DOM。
2. `startLogin` 未显式传判定时自动使用该探针。
3. `openLoginWindow` 去掉「URL 不像登录页就算成功」的兜底：没有明确判定时一律视为未登录，等到超时或用户取消。
4. `checkSession` 在没有判定函数时返回 `unknown` 而不是 `connected`（宁可让用户复查，也不假装已登录）。
5. 账号健康检查路由也接上探针。
6. 用户手动关窗记为 `cancelled`（正常操作），不再报成错误。
7. 登录等待默认时长 180s → 300s，容纳扫码 + 短信验证。
8. 补齐取消链路：`DELETE /api/publish/accounts/connect/:id` + 前端「取消登录」按钮；关掉弹窗会真正关掉浏览器窗口，不会把它留到超时阻塞下一次连接。
9. `pump()` 的 `finally` 不再假设 `running` 非空（验证脚本在任务收尾时重置会触发空指针）。

## 真实环境验证（2026-10-26）

调 `POST /api/publish/accounts/connect` 连接抖音，观察会话状态：

| 时间 | 状态 |
|---|---|
| +0s | `opening`（正在打开浏览器） |
| +12s | `awaiting`（等待扫码或窗口内登录） |
| +20s | 仍为 `awaiting` |

修复前会在第一轮轮询（约 1 秒）就变成 `done` 并关窗。现在窗口持续等待人工扫码。
调 `DELETE .../connect/:id` 后状态变为 `cancelled`，浏览器窗口随之关闭。

## 回归用例

- `verify-publish-api.mjs`：「未登录不会因 URL 不像登录页就判成功」——用不含 login 的后台地址 + 无上传框页面，断言状态不是 `done` 且至少等待 3 秒。
- 同文件：「checkSession 没有判定函数时如实返回 unknown」「checkSession 带后台判定时为 connected」。

## 仍未验证

真实登录态下的登录成功判定还没有跑过（本机无已登录账号）。抖音登录后是否出现 `input[type="file"]` 需要人扫码后确认；若登录后仍无该元素，需要把抖音的 `checkSession` 改成更可靠的标志（例如认证 cookie `sessionid`）。

---

## 第二次修复：判定改用会话 cookie（2026-10-26）

第一次修复后仍然「扫码后没反应」。用实际扫码成功的 profile 排查，确认扫码本身是成功的：

```
projects/.publish-profiles/pa-mvp7xiw1-daf034/Default/Cookies 里有 49 条抖音 cookie，包含：
  sessionid ✅  sessionid_ss ✅  sid_tt ✅  uid_tt ✅  sid_guard ✅  sid_ucp_v1 ✅  ssid_ucp_v1 ✅
```

同一份 profile 下对比两种判定：

| 判定方式 | 结果 |
|---|---|
| cookie-first（新） | `connected`（会话有效） |
| 仅 DOM（上一版） | `unknown`（页面结构无法确认登录状态） |

原因：登录窗口停在 `creator-micro/content/upload`，扫码完成时页面不会自动重渲染出上传框，DOM 判定就一直不成立，界面上表现为「扫完没反应」。而 cookie 在扫码成功的那一刻就已写入。

### 现在的判定顺序

1. `adapterLoginProbe` 先检查平台声明的会话 cookie（`server/publish-platforms.mjs` 的 `sessionCookies`）：抖音 `sessionid / sessionid_ss / sid_tt`，B 站 `SESSDATA / DedeUserID`，小红书 `web_session` 等，14 个平台都已声明。
2. cookie 不存在时，退回适配器的 `checkSession` DOM 判定（连续两次确认）。

### 真实环境验证

- 用已登录 profile 调 `POST /api/publish/accounts/:id/check` → `status: connected`，账号列表随之变为 `connected`。
- 关闭登录窗口后 cookie 仍在，说明 profile 持久化正常。

### 抖音封面入口探测结果

登录态下打开 `creator-micro/content/upload`：

- HTTP 200，页面含「上传视频」，不含「扫码登录」→ 登录态有效；
- 有 1 个 `input[type="file"]`（accept 覆盖 mp4/mov/mkv 等），未隐藏；
- 页面**不含**「封面」字样，`[class*="cover"]` 元素为 0 个。

结论：抖音的封面设置入口**只在上传视频完成后才渲染**，无法在空白上传页取得选择器。因此任务 5.1 仍无法完成——不是因为没有登录态，而是因为必须先真正上传一个视频。这需要在有登录态的前提下跑一次真实任务（会消耗一次真实上传），属于需要用户明确同意的操作。

---

## 第三次修复：重新登录秒关 + 聊天连接无反应（2026-10-26）

cookie 判定上线后又暴露两个问题，都是本次修复引入或遗漏的：

### 问题 A：已登录账号点「重新登录」，窗口 4 秒自己关

复现：对 `status=connected` 的抖音账号调 `POST /accounts/connect`，状态序列 `opening → awaiting → done`，第 4 秒变成 `done`。

原因：cookie 判定是「有 sessionid 就算登录成功」，已登录账号的 profile 里 cookie 本来就在，所以第一轮就成立。这是我加 cookie 判定时引入的回退——判定对了，但用错了场合。

修复：
- `startLogin` 增加 `requireConfirm` 模式。重新登录（账号已存在）时窗口不会自己完成，必须用户点「我已完成登录」。
- 新增 `POST /accounts/connect/:id/confirm`；确认时仍由平台会话（cookie/DOM）裁决，用户点按钮不等于伪造成功——没检测到登录会退回等待并提示。
- 界面在确认模式下显示「我已完成登录」按钮，并实时反映 `detected`（已检测到登录状态）。

### 问题 B：聊天里说「继续发布」、扫码后没反应

原因有两个，叠加在一起：
1. 聊天工具 `connect_account` 不传 `accountId`，路由每次都 `upsertAccount` 新建账号 → 新建空 profile 目录 → 上次扫码的会话丢失，等于让用户对着一个空浏览器再扫一遍；
2. 聊天路径没有任何人轮询登录状态（只有账号页弹窗会 poll），所以即使登录成功，账号状态也不会落库，界面一直显示未连接。

修复：
- 路由改为先 `findAccountByPlatform` 复用已有账号与 profile；选择顺序是「已连接 > 未知 > 其他，再按更新时间倒序」，避免拿到历史遗留的空账号。
- `startLogin` 新增 `onResult` 回调，登录结束直接落库，不依赖谁在轮询。
- 助手 `connectAccount` 在后台轮询到结束再刷新账号列表。

### 问题 C：浏览器被外力关闭后永久无法再连接（排查时发现）

kill 掉登录窗口进程后，`activeSession` 永远不被清空，之后每次连接都被「已有登录窗口在进行中」拒绝；同时 profile 里残留 `SingletonLock`，即使会话清空也打不开同一 profile。

修复：
- `openLoginWindow` 监听 context 的 `close` 事件，等待循环据此退出；
- `startLogin` 遇到残留的已结束会话时自愈，不再永久拒绝；
- 新增 `clearStaleSingletonLocks()`，启动登录前清掉 SingletonLock / SingletonSocket / SingletonCookie。

顺带：自动模式下窗口至少停留 `minDwellMs`（默认 4 秒），不再一闪而过。

### 真实环境验证

| 场景 | 结果 |
|---|---|
| 已登录账号点重新登录 | `opening → awaiting(detected=true)` 持续 8 秒不自行结束；点确认后 `done` |
| 聊天路径连接（不传 accountId） | 复用「抖音主号」，账号总数不变，不新建空 profile |
| kill 掉登录窗口后重连 | 自愈成功，不再报「已有登录窗口在进行中」 |
| 完整确认流程 | 连接 → 检测到登录 → 确认 → `done`，账号保持 `connected` |

### 回归用例

`verify-publish-api.mjs` 新增「重新登录不会因已有 cookie 而自动完成」：注入恒为 true 的判定，断言 `requireConfirm=true` 时状态停在 `awaiting`、`detected=true`，点确认后才变 `done`。
