# Tasks

## 1. 类型与边界来源

- [x] 1.1 `src/types.ts` 的 `TransitionBoundary` 增加可选 `outFrom` / `inFrom`（枚举 `source-frame | target-frame | source-tail | target-head | library | manual`）；`src/transition.ts` 的 `normalizeGenerated` 透传两字段；验证：`npx tsc --noEmit` 通过，且旧存档（无来源字段）normalize 后字段为空不报错
- [x] 1.2 新增 `boundarySourceLabel(source)` 纯函数返回中性/实际来源文案；验证：`verify-transitions.mjs` 断言有来源与无来源两种标签

## 2. 候选计算

- [x] 2.1 `src/transitionGen.ts` 新增 `transitionBoundaryCandidates(source, target)`：首帧候选含上镜当前画面、上镜 `candidates` 全部图、上镜 `refExtras`；尾帧同理取上镜/下镜对应项；每项带 `from` 来源类别；验证：`verify-transitions.mjs` 用 mock 节点断言候选数量与顺序
- [x] 2.2 抽帧候选入口：`TransitionPanel` 调 `ensureTransitionBoundary` 后把 `out`/`in` 作为 `source-tail` / `target-head` 候选并入本地状态，不写项目；验证：`verify-transitions.mjs` 断言调用前后 `generated.boundary` 不变

## 3. 弹窗改造

- [x] 3.1 `src/OutgoingReferencePickerModal.tsx` 的首尾帧页改由 `boundarySlots` 驱动：两槽始终渲染（`rows.length === 0` 才显示无槽位提示）；每槽含当前选择缩略图、候选网格、清除按钮、手填地址框；验证：`verify-transitions.mjs` 或 UI 契约测试断言空边界时仍渲染两个槽位
- [x] 3.2 点选候选写入对应槽位并带来源；再次点选同一候选取消；验证：选择→取消后 `generated.boundary.out` 恢复为空
- [x] 3.3 媒体库入口复用 `MediaPicker`（`accept: ['image']`），确认后写入槽位并标 `library`；验证：手测或契约测试断言确认后 `outFrom === 'library'`
- [x] 3.4 文案更新：「首尾帧锁定过渡起点与终点」改为说明「需手动选择，未选不能生成」；验证：文案不含「自动」或「刷新边界」的强制性表述

## 4. 面板与生成路径

- [x] 4.1 `src/TransitionPanel.tsx` 用 `transitionBoundaryCandidates` + 本地抽帧候选构造 `boundarySlots` 传给弹窗；`boundaryRows` 不再来自 `preview.attachments`；验证：`npx tsc --noEmit` 通过，`detail` 打开时两槽可见
- [x] 4.2 面板高级区按钮文案「从两镜成片刷新」改为「抽取两镜成片帧」，摘要改为「首帧已选 / 首帧未选」；验证：面板文案与 spec 场景一致
- [x] 4.3 `src/App.tsx` 删除 `generateTransitionVideo` 中的 `ensureTransitionBoundary` 调用与 `generatedWithBoundary`，改用 `g`；验证：`verify-transitions.mjs` 断言生成路径不调用抽帧（mock `extractFrames` 计数为 0）
- [x] 4.4 `src/transitionGen.ts` 的 `buildTransitionVideoPreview` 附件标签改用 `boundarySourceLabel`；blocking 文案改为「请选择首帧与尾帧」；验证：`verify-transitions.mjs` 断言缺边界时 message 含「选择」不含「刷新」
- [x] 4.5 `vite.config.ts` 首尾直变缺少边界的 400 文案改为要求先选择首帧与尾帧；验证：`verify-transitions.mjs` 或 `verify-video-api.mjs` 断言文案

## 5. 验收与文档

- [x] 5.1 扩展 `verify-transitions.mjs`：候选计算、抽取不落库、生成不重抽、来源标签、缺边界 blocking 文案；验证：`node verify-transitions.mjs` 退出码 0
- [x] 5.2 更新 `README.md:236` 转场章节：首尾帧改为「不预选，手动选择；两帧齐全才能生成」；验证：README 不再写「边界帧自动取上一镜尾帧 / 下一镜首帧」
- [x] 5.3 编写 `ACCEPTANCE.md`：空态两槽、点选/清除、抽取只产候选、生成不覆盖、旧项目边界保留、缺帧阻止；验证：清单覆盖每个 spec 场景
- [x] 5.4 `openspec validate transition-manual-boundary --strict` 通过；验证：命令退出码 0

## Workflow follow-up

- 完成后 `/opsx-archive transition-manual-boundary` 合并 delta 至 `openspec/specs/shot-transition-video-prompt/spec.md`。
- 若 `transition-video-shot-parity` 仍 active，归档时确认两者对「结构锚点」的表述不冲突。
