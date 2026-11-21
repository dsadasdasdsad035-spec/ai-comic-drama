# Tasks

## 1. 共享抽帧与类型

- [x] 1.1 抽出 `src/clipBoundaryFrames.ts`（从 `transitionGen` 迁移 `videoFrames` + 常量），`ensureTransitionBoundary` 改 import；验证：`npx tsc --noEmit` 通过且 `verify-transitions.mjs` 仍绿。
- [x] 1.2 `ProjectAsset` 增加 `sourceShotId`、`frameRole`、`sourceClipFingerprint`；`assetsPayloadOf` / `newAssetCard` 透传字段；验证：类型检查通过，旧项目 `patchProject` 不带新字段仍可加载。

## 2. 发布与幂等核心

- [x] 2.1 实现 `upsertClipFrameAsset`（查 assets 同源、抽帧、`newAssetCard` 或更新 url、双写 `patchProject` assets + canvas nodes）；验证：单元或 `verify-*` 脚本断言同 `sourceShotId+tail` 二次调用只一张卡且 url 变化。
- [x] 2.2 实现 `linkPrevShotTailFrame`（邻镜、写 `refIds`、不碰 `shot-prev`）；验证：mock 两镜项目第二次调用不重复 token。
- [x] 2.3 在 `App.tsx` 挂接回调传给 Inspector（含 nodes/assets/setState/patchProject）；验证：桌面 dev 手工点抽尾帧后 `project.json` assets 含溯源字段。

## 3. Inspector UI

- [x] 3.1 成片区块增加三按钮与 busy/error/note 态（对齐 `shot-inspector-layout` delta）；验证：首镜隐藏/禁用「引用上一镜尾帧」，有成片时抽帧可点。
- [x] 3.2 发布成功后 toast 或角标提示素材卡标题；验证：画布素材带出现对应标题。

## 4. 验收脚本

- [x] 4.1 新增 `verify-shot-clip-frame-assets.mjs`：无成片拒绝、覆盖幂等、`refIds` 写入、无 `shot-prev`；验证：`node verify-shot-clip-frame-assets.mjs` 退出码 0。

## 5. Agent（可选）

- [x] 5.1 `publish_shot_clip_frame` / `link_prev_shot_tail_frame` 调同一 upsert/link 函数；验证：`tests/shot-video-harness-tools.ts` 或新用例断言 refIds。

## Workflow follow-up

- 实现完成后运行 `/opsx-archive` 同步 specs（评审通过后）。