# Design

## Context

- 转场配置存于源镜头 `transitionOut`，生成模式默认 `bridging: morph`，客户端 `ensureTransitionBoundary` 抽上镜尾/下镜首。
- `TransitionGenerated` 已有 `inheritRefs`、`refIds`、`excludeRefIds`；`effectiveTransitionRefs` 已实现，但 `TransitionPanel` 未编辑，`generateTransitionVideo` 未传 `refImages`。
- APIMart 转场分支（`vite.config.ts`）在 `transition` 存在时强制 `refSources = []`，注释 citing Seedance 2.5 尾帧与 `reference_image` 互斥。
- 分镜侧 `buildShotVideoRequest` + `VideoPromptPanel` 已是「预览 = 请求」的参考实现。

动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 单一拼装函数扩展 `buildTransitionVideoPreview` → `buildTransitionVideoRequest`（名称可调整），输出与 `startVideo` 同构。
- `TransitionPanel` 复用 `vp-panel` 分区：summary、结构锚点、风格参考、提示词层、正文、生成。
- morph + 2.5：UI 诚实地标「风格参考未进 API」；为非互斥模型/策略预留提交路径。
- 指纹：`transitionFingerprint` 纳入有效风格参考集合与边界 URL（hash）。

**Non-Goals:**

- 转场参考视频、原生音频（与转场渠道限制一致，首期不做）。
- 「仅首帧 + 多图」bridging 全链路（可在 tasks 留 P2，除非 API 验证通过再开）。
- 画布边 stale 徽标、批量生成转场。
- 改动效果转场 / FFmpeg 预设 / Agent 建议规则。

## Decisions

### 1. 拼装层位置

**决策：** 在 `transitionGen.ts` 扩展预览类型，增加 `styleRefs`、`omitted`、`submittedRefs`（布尔或 reason），由 `TransitionPanel` 与 `App.generateTransitionVideo` 共用。

**备选：** 拆 `transitionVideoPrompt.ts` 新文件 — 仅在 `transitionGen.ts` 超过 ~600 行时再拆。

### 2. UI 结构

**决策：** 不立刻抽共享 React 组件；复制 `VideoPromptPanel` 的布局类名与交互模式到 `TransitionPanel`，减少首期 refactor 面。

**备选：** 抽象 `VideoRequestPanel<T>` — 二期若分镜/转场字段稳定再抽。

### 3. API 提交策略（首期）

**决策：**

| bridging | 模型 | 提交 |
|----------|------|------|
| morph | Seedance 2.5 / Kling v3 + lastFrame | `transition.boundaryOut/In`，`refImages: []` |
| morph | 方舟等无尾帧 | 关键帧/首帧 only（现有） |
| （未来）ref-first | 支持 refMode、无尾帧 | `refImages` 来自 `effectiveTransitionRefs`，无 `boundaryIn` |

客户端 `startVideo` 在 morph+2.5 时仍不传 ref；预览 MUST 列出「未提交」原因码 `morph-last-frame-ref-mutex`。

**备选：** 强制把风格参考写进 prompt 占位 — 仅作补充，不替代清单展示。

### 4. 风格参考编辑 UX

**决策：**

- 顶部 toggle：`继承两镜连线参考` → `inheritRefs`。
- 列表行：标签、缩略图、排除按钮；继承项与增补项视觉区分（badge「继承」）。
- 「+ 补充参考」：下拉 `transitionRefCandidates` 中未选 token。
- 超限：复用 `clampKeyframeRefs` 或 shot 同源上限常量，省略区同分镜 `omitted`。

### 5. 结构锚点

**决策：** 保留现有边界输入 + 刷新按钮；summary 增加来源说明（成片时间码若 `ensureTransitionBoundary` 可返回则展示，否则 P2）。

### 6. 测试

**决策：** 扩展 `verify-transitions.mjs`：对 `buildTransitionVideoRequest` 做快照/断言（refs 列表、blocking、prompt 与 `effectiveTransitionVideoPrompt` 一致）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 用户以为排除参考会影响 API，但 morph 下仍不提交 | 互斥说明 + summary「风格参考 0 张已提交」 |
| 未来打开 ref 提交后旧项目行为变 | bridging 默认 morph 不变；新策略显式选择 |
| 指纹频繁 stale | 仅 hash 有效 ref token 集合 + boundary，不含候选池全集 |
| 双份 UI 逻辑与分镜漂移 | tasks 含「对照 shot-video-prompt 验收清单」 |

## Migration Plan

- 无数据迁移：`inheritRefs` 默认 true 已存在。
- 部署：前后端同发；旧转场仅多面板字段，不改变已存成片 URL。
- 回滚：隐藏新 UI 区块即可，数据字段向后兼容。

## Open Questions

- Seedance 2.5 官方是否即将允许尾帧 + 多图同送？→ 需一次 APIMart 试调任务记录后再开 P2 bridging。
- 是否将衔接约束段改为可编辑（当前 spec 保持只读/自动）？
