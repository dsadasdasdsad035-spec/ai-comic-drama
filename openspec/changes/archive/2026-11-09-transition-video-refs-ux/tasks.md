# Tasks

## 1. 拼装层（预览 = 请求）

- [x] 1.1 在 `transitionGen.ts` 扩展 `buildTransitionVideoPreview`（或新增 `buildTransitionVideoRequest`），输出结构锚点、风格参考、省略项、`submitted`/`omittedReason` 与 blocking/warnings；跑 `node verify-transitions.mjs` 新增用例通过
- [x] 1.2 `generateTransitionVideo` 改为仅消费拼装结果组 `startVideo` 参数；手改/自动 prompt 与预览逐字一致（用例或现有 verify 断言）
- [x] 1.3 `transitionFingerprint` 纳入边界 URL 与有效风格参考 token 集；改参考后 stale 逻辑在面板可见（单测或 verify 断言 hash 变化）

## 2. 转场面板 UI

- [x] 2.1 `TransitionPanel` 增加风格参考区：继承开关、排除、增补（`transitionRefCandidates`）；状态写入 `inheritRefs` / `excludeRefIds` / `refIds`；目视检查持久化（刷新边后仍保留）
- [x] 2.2 对齐 `vp-panel` 分区：summary 含「结构 N · 风格 M（已提交 K）」、只读衔接折叠、手改/stale 徽章；样式复用 `theme.css` 现有 `vp-*` / `tr-vp`
- [x] 2.3 morph + 支持尾帧模型下，未提交的参考显示原因文案（`morph-last-frame-ref-mutex`）；blocking 链到「刷新边界」等按钮行为不变

## 3. 服务端与一致性

- [x] 3.1 核对 `vite.config.ts` 转场分支与客户端 preview 的 `submitted` 标志一致；改错配时补注释与 400 文案；`node verify-transitions.mjs` 仍全绿
- [x] 3.2 （可选 P2）在 `design.md` Open Questions 有结论后，为非互斥模型实现 `refImages` 提交路径 + preview `submitted: true`；未做则 tasks 勾选仅 3.1（首期未做，待 API 验证）

## 4. 验收对照

- [x] 4.1 按 `openspec/changes/transition-video-refs-ux/specs/shot-transition-video-prompt/spec.md` 场景做人工验收清单（预览=请求、排除参考、手改优先、stale）并记在 PR 或 commit 说明 → 见同目录 `ACCEPTANCE.md`
- [x] 4.2 `openspec validate transition-video-refs-ux` 通过

## Workflow follow-up

- 实现完成后运行 `/opsx-apply`，再按项目流程 archive 并同步 `openspec/specs/shot-transition-video-prompt/spec.md`。
