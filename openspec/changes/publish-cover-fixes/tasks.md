# Tasks

## 1. 封面比例单一来源

- [x] 1.1 在 `server/publish-platforms.mjs` 导出完整四档 `COVER_ASPECTS`，并让 `server/deliverables.mjs` 的规范化直接引用它；验证：`node verify-publish-contract.mjs` 通过，且新增用例断言「每个平台声明的每个比例都能被 `normalizeDeliverableConfig` 保留」。
- [x] 1.2 规范化只接受以 `/` 开头的站内地址，丢弃 `data:` 与历史截断残片；验证：新增用例输入四档 + 一个 dataURL，断言四档全部保留、dataURL 被丢弃。
- [x] 1.3 对齐前端比例常量与展示顺序，确保 `src/publish/types.ts` 的四档与服务端集合一致；验证：在 `verify-publish-ui.mjs` 中断言封面区出现平台所需比例，且 `npm run build` 的 `tsc --noEmit` 通过。

## 2. 抽帧封面落盘与按比例裁切

- [x] 2.1 在 `src/publish/frames.ts` 增加按目标比例居中裁切后编码的能力；验证：纯函数用例覆盖四种比例的裁切矩形，输出宽高比与目标一致。
- [x] 2.2 改造 `src/publish/CoverPicker.tsx`：抽帧结果先经 `/api/save-image` 落盘再写入配置，`prefix` 使用 `cover-<比例>`；验证：`verify-publish-ui.mjs` 用 route 拦截 `/api/save-image` 后点「从成片抽帧」，断言写入配置的是返回的文件地址而非 dataURL。
- [x] 2.3 改造助手 `set_cover(source=frame)` 走同一落盘路径；验证：`tests/publish-chat.ts` 注入抽帧替身时断言落盘后的地址被写入配置，落盘失败时返回「未准备好」而不是「已准备」。
- [x] 2.4 更新 `README.md` 发布台封面说明与 `docs/creative-studio.md` 的相关口径，写明抽帧封面会落盘为站内文件；验证：按文档描述手动点一次抽帧，刷新后封面仍在。

## 3. 适配器封面能力与任务上下文

- [x] 3.1 在适配器注册项增加 `coverSupport: 'supported' | 'unverified' | 'unsupported'`，默认 `unverified`，并在注册校验中拒绝非法值；验证：`node verify-publish-contract.mjs` 新增用例覆盖默认值与非法值。
- [x] 3.2 `server/publish-queue.mjs` 组装上下文时按平台比例取已准备封面，解析为绝对路径放入 `ctx.coverPath` 与 `ctx.covers`；验证：`verify-publish-queue.mjs` 的假适配器断言收到封面路径，缺封面时为空串。
- [x] 3.3 任务结束把 `coverAttached` 与原因写入事件与 payload，且阶段说明只描述实际动作（不再出现「填写文案与封面」）；验证：队列用例断言 `coverSupport=unverified` 时 `coverAttached=false` 且事件文案不含「封面已填写」。
- [x] 3.4 `server/publish-preflight.mjs` 对「已选平台需要封面但适配器不能自动投递」追加 `warn`；验证：`verify-publish-contract.mjs` 断言该警告存在且不阻断提交。

## 4. 集成回归

- [x] 4.1 扩充 `verify-publish-api.mjs` 的端到端用例：四档封面保存后回读、抽帧地址落盘后预检通过、暂存确认后任务上下文含封面；验证：脚本整体通过。
- [x] 4.2 跑通全部发布验收（`verify-publish-contract/api/queue/intent/assistant/ui`）确认无回归；验证：每个脚本退出码为 0。

## 5. 真实平台封面投递验证

- [ ] 5.1 在已登录的真实会话下核对抖音与 B 站「设置封面」入口与选择器，记录截图或步骤证据到本变更的 `evidence/`；验证：证据文件存在并写明通过/不通过。
- [ ] 5.2 选择器确认后为对应适配器实现封面步骤并把 `coverSupport` 翻为 `supported`；验证：真实登录态跑一次草稿任务，平台草稿封面为所选封面。
- [x] 5.3 无法完成登录态验证时，保留 `unverified` 并在 `design.md` 的 Risks 中记录实际阻塞原因；验证：记录存在且预检仍如实提示需手动设置封面。
