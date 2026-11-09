# Design

## Context

- 分镜侧 `buildShotVideoRequest` + `VideoPromptPanel` 已是预览=请求的参考实现；转场侧 `buildTransitionVideoPreview` 使用独立的 `effectiveTransitionRefs`（不含 adjacent/expression），且 `submitStyle = false`。
- `TransitionPanel` 在「生成」下自建分区（结构锚点、风格参考），未嵌入模型选择与分镜式参考列表。
- 服务端 APIMart 转场分支：`refSources = transition ? [] : refImages`，`effVideoRefMode = false`（`vite.config.ts`）。
- 近期变更已对齐手改、底栏、`shot-transition-video-prompt` 多条需求；归档 design `transition-video-refs-ux` 曾将参考视频/原生音频列为 Non-Goals，本变更 explicit 推翻。

见 `proposal.md` — Why。

## Goals / Non-Goals

**Goals:**

- 单一转场拼装入口输出与 `ShotVideoRequest` **同构**（或共享 `OutgoingVideoPreview` 类型），供 UI 与 `generateTransitionVideo` 共用。
- 双镜合并：对 source/target 各调用与 `buildShotVideoRequest` 相同的 ref 收集管线，合并去重后套 `limitVideoReferenceImages`；首尾帧来自 `ensureTransitionBoundary`，注入为 first/last attachment。
- 抽取 **VideoOutgoingWorkbench**（名可调整）：`variant: 'shot' | 'transition'`；转场面板仅保留接缝三态 + effect + workbench。
- 按模型/bridging 计算 `submitted`；非互斥时客户端传 `refImages`/视频参考，服务端转场路径对称处理。
- 原生音频：展示 `NativeAudioPanel` disabled + 声音描述进 prompt（策略 A）。
- 指纹 `transitionFingerprint` 纳入合并 refs/mode/边界 hash。

**Non-Goals:**

- 转场边启用真实 native 音色参考或多说话人音频。
- 分镜 Inspector 功能删减（仅抽取共享组件）。
- 画布边 stale 徽标、批量转场生成。
- 新 bridging「仅首帧+多图」产品化（保留代码扩展点即可）。

## Decisions

### 1. 拼装：双镜合并函数

**决策：** 在 `transitionGen.ts`（或新建 `transitionVideoRequest.ts` 若超 ~800 行）实现 `buildTransitionVideoRequest` 调用 `collectComposerRefs` + `collectVideoReferences` 各两次，合并顺序：上镜 refs 在前、下镜在后，URL 去重保留先遇条目；再 `limitVideoReferenceImages`。提示词层保留转场 `prompt`/`soundPrompt`/衔接块 + `effectiveTransitionVideoPrompt` override。

**备选：** 两次 `buildShotVideoRequest` 再合并 — prompt/seconds 字段噪声大，不采用。

### 2. 与 ShotVideoRequest 类型

**决策：** 扩展或复用 `ShotVideoRequest`；转场专有字段（`attachments` 角色 first_frame/last_frame、`bridging`、`requestSeconds`/`trimTo`）放入扩展类型 `TransitionVideoRequest = ShotVideoRequest & { ... }`，`VideoPromptPanel` 接受联合类型。

**备选：** 完全独立类型 — UI 重复，不采用。

### 3. inheritRefs / excludeRefIds

**决策：** `inheritRefs === false` → 跳过双镜 merge，仅 `refIds` 增补 + 结构帧。`excludeRefIds` 在 merge 后过滤 token。弃用单独「风格参考」标题，统一 `vp-refs` 列表（图序与分镜一致）。

### 4. 提交策略

**决策：** 与分镜共用 `styleRefOmitReason` / morph 互斥判断；`submitStyle = !omitMutex`（删除写死 false）。服务端：当 `transition && !morphMutex && refImages.length` 时走与分镜相同 upload 路径；`effVideoRefMode` 在转场且存在 refVideos 时与分镜一致。

**备选：** 永远服务端禁 ref — 与「完全同一套」冲突。

### 5. UI 抽取顺序

**决策：** 先抽离纯展示+手改组件（`VideoOutgoingWorkbench`：模型、分辨率、NativeAudio disabled、refs 列表、底栏 props）；`TransitionPanel` 删除重复 `tr-vp` 块；`Inspector` video tab 改引用同一组件。第二期再统一 CSS token。

### 6. 测试

**决策：** `verify-transitions.mjs` 增加：双镜连线合并、相邻 token、mutex 下 submitted=0 且 omitted 有因、非 mutex 下 refImages 长度；快照 prompt/ref 列表。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 双镜合并后参考超上限用户困惑 | 与分镜相同 omitted 文案；summary 行显示 N/M |
| 2.5 morph 用户以为参考会进 API | 保留互斥 scenario；与分镜 lastFrame+ref 教育一致 |
| 服务端放开 ref 后上游报错 | 客户端与服务端共用互斥判断；集成测试一条真请求 |
| 抽取组件回归分镜 | tasks 含 Inspector 手工验收清单 |
| inheritRefs 与新区块语义重叠 | UI 保留一 toggle，文档化 false = 仅增补 |

## Migration Plan

1. 先合并拼装 + 单测，再改 `generateTransitionVideo` + 服务端，最后 UI 抽取（避免半截 UI）。
2. 已有项目 `excludeRefIds`/`refIds` 不变；合并后列表可能变长 — 非破坏性。
3. 回滚：feature 可暂用 env 禁用 ref 提交（仅应急，非默认）。

## Open Questions

- `buildTransitionVideoRequest` 文件拆分阈值：实现时若 `transitionGen.ts` >900 行再拆 `transitionVideoRequest.ts`。
- 参考视频在 morph+2.5 下是否与参考图共享互斥表 — 实现时对照 APIMart 文档与分镜 `video` 模式行为实测。
