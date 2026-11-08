# Tasks

## 1. 视频拼装解耦

- [x] 1.1 从 `collectComposerRefs` 移除对 `refImage` 的自动 push，并去掉 native/first 模式对 `refImage` 的兜底；验证：`node verify-video-ref-api.mjs` 中断言无连线时不含 current 槽位
- [x] 1.2 更新 `no-image` / `native-no-image` 文案为连线导向；验证：纯 `refImage` 镜头在 Inspector 视频面板出现 blocking 且不含隐式图1
- [x] 1.3 调整 `fingerprintOf` / 预览面板使附件候选列表与提交 refs 一致；验证：手改过期在仅改 `refImage` 时不误报附件变化（或文档化若仍变更 fingerprint）

## 2. 静帧出图落库

- [x] 2.1 确认 `App.tsx` `generateOne`（及 Inspector 等价路径）始终带 `project` 落盘；验证：出图后 URL 为 `/project-assets/` 且出现在 `listMedia` 生成列表
- [x] 2.2 确认出图成功不创建素材卡、不改 `refIds`；验证：新增 `verify-shot-still-image-library.mjs` 或扩展现有脚本断言节点数与 refIds
- [x] 2.3 更新 README「出图 / 出片 / 参考优先级」段落，写明方案 2 工作流；验证：人工对照文档与 Inspector 附件清单

## 3. UI 与邻镜

- [x] 3.1 更新 Inspector 视频 Tab 附件清单展示与 hint（去掉默认「当前画面」示例）；验证：`verify-shot-inspector.mjs` 或 Playwright 片段断言文案
- [x] 3.2 确认 `SHOT_PREV`/`SHOT_NEXT` 仍取邻镜 `refImage` 且作为显式相邻项；验证：`verify-neighbor-ui.mjs` / ref 相关脚本通过
- [x] 3.3 检查右击连线、节点菜单中「当前画面」相关 hint，避免暗示出图即可出片；验证：检索 UI 字符串并人工点检

## 4. 回归与规格

- [x] 4.1 修订受影响 verify 脚本中对「图1=当前画面」的假设；验证：相关 `node verify-*.mjs` 全绿
- [x] 4.2 运行 `openspec validate shot-image-library-video-refs --strict` 通过

## Workflow follow-up

- Archive the change after review and green CI/local verifies.
- Sync main specs on archive.
