# 验收清单（transition-video-refs-ux）

- [ ] **预览=请求**：展开「本次转场出片」，最终正文与生成时 `/api/seedance` 的 `prompt` 一致（可用网络面板核对）。
- [ ] **结构锚点**：缺边界时生成禁用；点「刷新边界帧」可补齐。
- [ ] **风格参考**：继承开关、排除、增补参考持久化；summary 显示「结构 N · 风格 M（已提交 K）」；morph+尾帧模型下显示互斥说明且 K=0。
- [ ] **手改优先**：手改全文后生成不含自动衔接段；可恢复自动拼装。
- [ ] **stale**：改边界或参考后，已有成片时出现「出片条件已变」提示。

自动化：`node verify-transitions.mjs` 全绿；`openspec validate transition-video-refs-ux` 通过。
