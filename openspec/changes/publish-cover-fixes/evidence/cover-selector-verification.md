# 真实平台封面选择器验证 —— 未完成

日期：2026-10-26

## 结论

**未验证（blocked）**。抖音与 B 站的「设置封面」入口未在真实登录态下核对，选择器证据为空。

## 阻塞原因

1. `data/projects/.publish-profiles/` 下 6 个 profile 目录全部为空（0 文件）。
2. 发布账号表（`publish_accounts`）0 条记录。
3. 登录创作者后台必须由人本人在有头浏览器中扫码完成；自动化不得代做，也不得绕过平台验证。
4. 没有登录态就无法取得可靠的 DOM 选择器，写进适配器只会变成「盲点 + 选择器超时」，比现状更难归因。

## 当前实际行为（可验收部分）

- 7 个内置适配器 `coverSupport` 均为 `unverified`，均未实现 `uploadCover`。
- 队列只在 `coverSupport === 'supported'` 且存在 `uploadCover` 时才执行封面动作。
- `unverified` / `unsupported` 时任务写入 `payload.coverAttached = false` 与 `coverNote`，并追加一条 `cover_skipped` 事件。
- 预检对「封面已备好但适配器不能自动投递」追加 `cover_manual` 警告（不阻断）。

以上由 `verify-publish-contract.mjs`、`verify-publish-queue.mjs`、`verify-publish-api.mjs` 覆盖。

## 解除阻塞的步骤

1. 在发布台「平台账号」页连接抖音与 B 站，各完成一次扫码登录。
2. 在真实后台核对封面入口：记录容器选择器、上传 input 选择器、确认按钮、是否在 iframe 内。
3. 为对应适配器实现 `uploadCover(page, ctx)`（用 `ctx.coverPath` 或 `ctx.covers[aspect]`）。
4. 将 `coverSupport` 改为 `supported`；`verified` 需另行评估，两者不是一个概念。
5. 跑一次真实草稿任务，确认平台草稿封面为所选图，并把截图放进本目录。
