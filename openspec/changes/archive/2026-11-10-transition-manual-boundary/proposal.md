# Proposal

## Why

转场「生成」的出片参考里，首尾帧是唯一还由系统自动决定的输入：弹窗打开就带值、点「从两镜成片刷新」直接覆盖、点生成时 `ensureTransitionBoundary` 再抽一次并覆盖用户手填。用户要的是与角色/素材参考一致的语义——**不预选、手动选、选了才算数**。当前还有两个连带缺陷：两槽为空时弹窗只显示「当前模式无首尾帧槽位」，无法手填；只有一个槽有值时，缺的那个槽没有输入行。

## What Changes

- **BREAKING** 结构首尾帧不再默认派生：`generated.boundary.out/in` 初始为空，只有用户在「选择出片参考 → 首尾帧」里点选后才写入。旧项目已存的 boundary 保留，视为此前手选。
- **BREAKING** 生成前不再自动抽帧：删除 `generateTransitionVideo` 里的 `ensureTransitionBoundary` 调用，请求只用已保存的边界；不再把自动抽取结果写回项目。
- **槽位行由能力驱动**：`bridging === 'morph'` 时始终渲染首帧/尾帧两行（含空态），不再依赖 `preview.attachments` 是否已有值；旧版关键帧模式仍显示「无首尾帧槽位」。
- **混合候选**：每个槽位提供
  - 上镜/下镜当前画面与全部候选图（打开即有，免费）；
  - 上镜尾帧、下镜首帧（点「抽取两镜成片帧」才产生，只作为候选，不写槽位）；
  - 项目媒体库图片；
  - 手填 URL 兜底。
- **点选手语义**：点候选即写入对应槽位，再点同一项或点「清除」置空；两槽都非空才可生成，缺任一则 blocking 文案改为「请选择首帧/尾帧」。
- **来源溯源（P1）**：`boundary` 增加可选 `outFrom` / `inFrom`，用于 `vp-refs` 与弹窗展示中性标签，避免选了媒体库图仍标「上一镜尾帧」。
- **规格与验收**：主 spec `shot-transition-video-prompt` 的「结构锚点可见且可校正」改为手动选择语义；README 与 `verify-transitions.mjs` 的自动抽帧用例改为候选抽取断言。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`: 结构首尾帧从「默认上一镜尾帧 / 下一镜首帧」改为「无预选、手动选择、双帧必填」；新增候选来源、抽取只产候选、生成不覆盖手选、空态行与来源标签要求。

## Impact

- **前端**：`src/OutgoingReferencePickerModal.tsx`（边界行空态、候选网格、点选/清除、来源标签）、`src/TransitionPanel.tsx`（边界行数据改由 bridging 能力与槽位状态生成、抽取候选回调、blocking 文案）、`src/App.tsx`（删除生成前二次抽取、新增抽候选入口，不改 `ensureTransitionBoundary` 本身）。
- **类型/拼装**：`src/types.ts`（`TransitionBoundary.outFrom/inFrom`）、`src/transition.ts`（`normalizeGenerated` 保留溯源、指纹不变）、`src/transitionGen.ts`（附件标签与候选生成 helper）。
- **服务端**：`vite.config.ts` 首尾帧缺失的报错文案与前端一致；无字段/协议变化。
- **数据**：`transition_out.generated.boundary` 结构向后兼容，无迁移。
- **文档/测试**：`README.md` 转场章节、`verify-transitions.mjs`、`ACCEPTANCE.md`。
