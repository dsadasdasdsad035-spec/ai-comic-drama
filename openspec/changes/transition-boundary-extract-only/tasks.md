# Tasks

## 1. 抽帧只认成片

- [x] 1.1 `src/transitionGen.ts` 的 `ensureTransitionBoundary` 删除两处 `currentShotImage` 回退，缺视频时返回空并给 warning；单侧失败不清空另一侧；验证：`node verify-transitions.mjs` 断言无视频时 `boundary.out/in` 为空且 warnings 含提示
- [x] 1.2 删除 `transitionBoundaryCandidates` 与 `BoundaryCandidate`；`shotFrameCandidates` 一并删除；验证：`npx tsc --noEmit` 无新增错误，且全仓 grep 无 `transitionBoundaryCandidates`
- [x] 1.3 `src/types.ts` 的 `BoundarySource` 注释标注：新写入只用 `source-tail` / `target-head`，其余值仅用于读旧数据；验证：`boundarySourceLabel` 仍能返回媒体库/手填标签

## 2. 抽取即写入

- [x] 2.1 `src/TransitionPanel.tsx` 删除 `extractedBoundary` 本地状态与 `boundarySlotCandidates`，`boundarySlots` 改为只含 `value` / `from` / 空 `candidates`；验证：`npx tsc --noEmit` 无新增错误
- [x] 2.2 `extractBoundaryCandidates` 改为一次写入：成功侧 `source-tail`/`target-head`，失败侧保留原值；失败文案汇总到 `extractError`；验证：`node verify-transitions.mjs` 断言抽取后 `boundary.outFrom === 'source-tail'`

## 3. 弹窗收敛

- [x] 3.1 `src/OutgoingReferencePickerModal.tsx` 删除候选网格、媒体库按钮、手填输入框与 `MediaPicker` 引用；每槽只保留「已选缩略图 / 未选择」「来源标签」「清除」；验证：`node verify-transitions.mjs` 断言弹窗源码无 `orp-cand-grid`、无 `MediaPicker`
- [x] 3.2 文案改为「首帧取上一镜成片最后一帧，尾帧取下一镜成片第一帧；点抽取一次填好两侧」；验证：文案含「最后一帧」「第一帧」，不含「媒体库」「手填」
- [x] 3.3 `src/theme.css` 删除 `.orp-cand*` 与 `.orp-slot-controls` 中不再使用的输入框样式；验证：`npx vite build` 成功

## 4. 验收与文档

- [x] 4.1 扩展 `verify-transitions.mjs`：无成片不回退静帧、抽取即写入两侧、单侧失败保留原值、弹窗无候选/媒体库、来源标签；验证：`node verify-transitions.mjs` 退出码 0
- [x] 4.2 `README.md` 转场章节改为「首帧/尾帧只能由两镜成片抽取」；验证：不再出现「媒体库」「手填地址」作为首尾帧来源
- [x] 4.3 编写 `ACCEPTANCE.md`：抽取即写入、无成片阻止、单侧失败、旧数据兼容、弹窗唯一动作；验证：覆盖 spec 每个场景
- [x] 4.4 `openspec validate transition-boundary-extract-only --strict` 通过；验证：命令退出码 0

## Workflow follow-up

- 完成后 `/opsx:archive transition-boundary-extract-only` 合并 delta 至 `openspec/specs/shot-transition-video-prompt/spec.md`。
- 归档时注意 REMOVED 的两条要求会从主 spec 删除。
