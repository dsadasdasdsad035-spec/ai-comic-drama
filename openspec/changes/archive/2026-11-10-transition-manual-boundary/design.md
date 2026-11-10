# Design

## Context

- 转场配置存在源镜 `transitionOut`，生成模式 anchor 策略 `bridging` 目前恒为 `morph`（`normalizeGenerated` 只保留 `keyframe` 旧值）。
- 边界帧来源链路：`ensureTransitionBoundary`（`src/transitionGen.ts`）抽上镜视频尾帧 / 下镜视频首帧，无视频回退当前画面；调用点两处——面板「刷新边界帧」（`App.refreshTransitionBoundary`）与生成前（`App.generateTransitionVideo`）。
- 弹窗 `OutgoingReferencePickerModal` 的「首尾帧」页行数据来自 `preview.attachments`，而附件只在 `generated.boundary` 有值时生成，所以空态无行可填。
- 参考图侧已完成同类迁移：`normalizeGenerated` 恒设 `inheritRefs: false`，只认 `generated.refIds` 的手动 token。本变更把首尾帧对齐到同一原则。
- 主规格现状见 `openspec/specs/shot-transition-video-prompt/spec.md`；本变更的 delta 见 `specs/shot-transition-video-prompt/spec.md`。

## Goals / Non-Goals

**Goals:**

- 首/尾帧槽位由能力驱动（`bridging === 'morph'`）而非值驱动，空态可操作。
- 抽取与选择解耦：抽帧是候选生产者，选择是显式写入。
- 生成路径只读已保存边界，消除二次抽取造成的覆盖。
- 来源可追溯，标签诚实。

**Non-Goals:**

- 不改 `bridging` 枚举，不恢复「仅首帧 + 多图」策略。
- 不改服务端首尾帧 payload 协议（`first_frame` / `last_frame` 角色不变）。
- 不引入新的持久化表或数据库迁移。
- 不改效果转场与既有 `ensureTransitionBoundary` 的抽帧实现（只改调用方与结果使用方式）。

## Decisions

### 1. 槽位行由 bridging 驱动，不由 attachments 驱动

**决策：** 弹窗接收 `boundarySlots`（两个固定槽位：`first` / `last`），而非从 `preview.attachments` 反推。`TransitionPanel` 在 `bridging === 'morph'` 时无条件构造两槽；`keyframe` 旧模式保留「无首尾帧槽位」提示。

**备选：** 继续用 attachments 但让 `buildTransitionVideoPreview` 在空边界时也输出两条无 URL 附件。否决：会把「未选」伪造成附件，污染 `vp-refs` 的提交清单与提示词 hint。

### 2. 候选在面板侧计算，弹窗只渲染

**决策：** 新增纯函数 `transitionBoundaryCandidates(source, target, nodes, ...)` 返回每槽候选（含来源类别），由 `TransitionPanel` 计算后传入弹窗；弹窗保持无业务依赖。

**备选：** 弹窗内直接读 nodes/characters。否决：弹窗已被设计为通用壳（注释写明「分镜视频 Tab 可复用」），塞入转场领域逻辑会让复用变差。

### 3. 抽取与选择分离

**决策：** `ensureTransitionBoundary` 保持纯函数语义不变，但新增调用方式：面板「抽取两镜成片帧」把结果写入**本地候选状态**（`useState`，不落项目），用户点选后才走 `setBoundaryUrl` 持久化。生成路径不再调用它。

**备选：** 给 `ensureTransitionBoundary` 加 `writeBack` 参数。否决：函数应当只做抽帧，持久化由调用方决定，避免出现「读一下就把项目改了」的隐式副作用。

### 4. 生成前校验改为纯读

**决策：** `generateTransitionVideo` 删除 `ensureTransitionBoundary` 调用与 `generatedWithBoundary` 中间变量，直接用 `g.boundary`。服务端已有 `morphTransition` 缺少 `boundaryOut/boundaryIn` 的 400 分支（`vite.config.ts`），保留并把文案改为「请先选择首帧与尾帧」。

**备选：** 客户端 block 后仍然调一次抽帧兜底。否决：这正是用户要删除的行为；缺边界应该在面板可见地解决。

### 5. 来源溯源的存储形态

**决策：** 在 `TransitionBoundary` 增加可选 `outFrom` / `inFrom`，取值为 `'source-frame' | 'target-frame' | 'source-tail' | 'target-head' | 'library' | 'manual'`。旧数据无字段时按「未知」处理，标签用中性文案「首帧 / 尾帧」。

**备选：** 只存 URL 不存来源，靠 URL 反查。否决：媒体库图与镜头画面可能同 URL，反查不可靠；且反查成本随候选池增长。

### 6. 指纹与 stale 不变

**决策：** `transitionFingerprint` 已包含 `boundaryOut/In`，不加 `outFrom/inFrom`。来源变化不影响出片结果，加进指纹会制造无意义的 stale。

## Risks / Trade-offs

- **[Risk] 用户习惯「一键刷新即齐全」** → 面板保留「抽取两镜成片帧」按钮，只是要求再点一次选择；文案明确「抽取结果需点选后生效」。
- **[Risk] 旧项目边界来源不明导致标签误导** → 无来源时用中性标签，不猜测。
- **[Risk] 候选过多撑爆弹窗** → 每槽候选限制在镜头画面 + 候选图 + 最多 6 张抽取帧 + 媒体库入口（点开复用 `MediaPicker`），媒体库不内联铺图。
- **[Risk] 手填 URL 与点选共存造成状态不清** → 手填框始终显示当前值；点选候选即覆盖手填框，两者同一数据源。
- **[Risk] 删除生成前抽帧后，老流程直接报错** → blocking 与 400 文案均为可执行指引（打开面板 → 选首尾帧），并在 `ACCEPTANCE.md` 明确旧数据回归。

## Migration Plan

- 无数据迁移。旧项目 `generated.boundary` 原样读取，视为已选；无来源字段按未知处理。
- 新旧行为差异仅在「生成时不再自动补边界」，属于预期的 BREAKING 行为；回滚只需恢复 `generateTransitionVideo` 中的 `ensureTransitionBoundary` 调用。
- 前后端需一起发布：前端不再提交空边界，服务端文案同步。
