# Design: transition-prompt-manual-only

## Context

动机见 `proposal.md - Why`。当前实现的关键事实：

- `effectiveTransitionVideoPrompt()` 产出 `{ text, source }`，`source` 为 `auto`（来自 `generated.prompt`）或 `override`（来自 `videoPromptOverride.text`）。
- `buildTransitionVideoPreview()` 拿到 `text` 后并不直接使用，而是交给 `finalizeTransitionPromptText()` 再拼一次：`auto` 分支返回 `base + continuity + structureHint`，`override` 分支返回 `base`。
- `transitionContinuityBlock()` 生成四行「景别/运镜/机位/动作衔接」，同时被塞进正文和 `preview.continuityPreview`（面板只读区）。
- `buildTransitionStructurePromptHint()` 生成「结构锚点：[首帧]=…，[尾帧]=…」一行，只用于正文。
- `keyframePrompt()` 当前**没有任何调用方**（全仓库仅定义与导出），内部仍保留 `defaultTransitionPrompt` 兜底 + 硬编码尾句。
- `defaultTransitionPrompt()` 有两个使用点：面板「用上下镜正文预填」按钮的 `prefillPrompt`，以及 `keyframePrompt` 的兜底。

因此这次改造是**减法**：把正文拼装的第二个阶段整体去掉，让 `effectivePrompt.text` 成为唯一出口。

## Goals / Non-Goals

**Goals**

- 正文来源在代码上只有一条路径，读代码时不需要判断「哪段是系统加的」。
- 面板与请求的一致性更容易断言：`preview.prompt === effectivePrompt.text`。
- 保留衔接推导能力，只是把它从「正文组成」降级为「只读参考」。

**Non-Goals**

- 不碰 `promptRender.ts` 的转场 bundle（九段渲染输入材料），`renderedPrompt` 属模型输出。
- 不引入「衔接段开关」。开关会让「正文到底含什么」多出一维状态，与本次要消除的歧义相反。
- 不改 `generated` 的数据结构，不做存量数据迁移。
- 不改 `transitionContinuityBlock` 的推导规则（哪些字段、怎么措辞），只改它的消费方。

## Decisions

### D1：`buildTransitionVideoPreview` 直接使用 `effectivePrompt.text`

删除 `finalizeTransitionPromptText`。改动后该函数体内：

```ts
const prompt = effectivePrompt.text
```

**替代方案 A：保留 `finalizeTransitionPromptText` 但让 `continuity` 与 `structureHint` 传空串。**
否决。函数会退化成 `return base`，却仍占着 7 个参数和「收尾拼装」的名字，下一个人加需求时最自然的动作就是往里再拼一段。删掉函数是这次变更的核心表达。

**替代方案 B：在手改正文时也追加结构锚点。**
否决。手改正文逐字发送是既有契约，也是用户对「我写什么就发什么」的预期锚点。

### D2：衔接信息只保留在 `preview.continuityPreview`

`transitionContinuityBlock()` 保留，调用点从「既拼正文又喂预览」收敛为「只喂预览」。`TransitionVideoPreview.continuityPreview` 字段保留，`TransitionPanel` 的只读折叠区继续渲染它，仅把标题由「自动衔接约束（只读，已写入自动正文）」改为「自动衔接约束（只读，不参与发送）」。

`continuityPreview` 为空串时该折叠区不渲染（沿用现有的 `preview.continuityPreview.trim()` 判断），手改态（`hasOverride`）同样不渲染 —— 与本次新增的 scenario「手改正文时不展示自动衔接」一致。

**替代方案：把衔接信息挪到别处（如出片摘要行）。** 否决。它需要完整句子，摘要行放不下；折叠区已是既有形态，改动面最小。

### D3：删除 `buildTransitionStructurePromptHint`

唯一调用方是 `finalizeTransitionPromptText`，随之删除。首尾帧的语义仍通过附件本身传达：请求里的 `firstFrame`/`lastFrame` 字段与 `vp-refs` 列表都已明确「哪张是首帧、哪张是尾帧」，不需要在正文里再用一句话说一遍。

### D4：`keyframePrompt` 退化为返回正文原文

改为：

```ts
export function keyframePrompt(...): string {
  const g = normalizeGenerated(generated)
  return g.prompt.trim()
}
```

去掉 `defaultTransitionPrompt` 兜底与「单幅过渡画面，不要分屏或左右拼接…」尾句。

**注意**：该函数当前无调用方。本次只做退化而**不删除导出**，避免仓库外可能存在的引用被静默打断；同时留一行注释说明「已无调用方，可另行清理」。真要删除应作为独立清理提交，不与行为变更混在一起。

**替代方案：连函数一起删。** 更干净，但会把「行为变更」和「死代码清理」耦合进同一个提交，出问题时难以二分定位。

### D5：`defaultTransitionPrompt` 保留，仅服务预填

`prefillPrompt` 的逻辑不变（`autoPrompt` 非空用 `autoPrompt`，否则用 `defaultTransitionPrompt`）。它是用户点击才触发的草稿生成，不参与出片拼装，因此不违反「正文只由人/Agent 决定」——最终发什么仍取决于用户是否保存/是否点生成。

`keyframePrompt` 不再依赖它之后，`defaultTransitionPrompt` 的调用方只剩 `prefillPrompt`，「仅用于预填」的注释可以删掉括号里的补充说明。

## Risks / Trade-offs

- **正文会明显变短，已出片的转场对不上** → 面板对 `videoMeta.prompt` 的展示保持不变（它就是当时实际发送的正文），预览与它会不一致，这是预期结果。在变更说明里写明「旧转场需重新出片才对齐」，不做自动回填。
- **衔接信息不再进正文后，出片可能出现跳切** → 责任转移给 Agent：`shot-transition-agent` 的技能文档需强调「写正文时要自己组织两镜的景别/运镜/动作衔接」。只读区为人保留了手动抄录的入口。技能文档更新不在本 change 的代码范围内，但需在 tasks 里记为文档同步项。
- **测试断言方向反转** → `tests/prompt-text-integrity.ts` 中「自动路径正文并入衔接块」这条会失败。它应改为断言 `preview.prompt` 逐字等于 `generated.prompt`，且不含 `衔接：` 与 `结构锚点`。这是本次唯一会主动改断言的测试，必须在同一提交内完成，否则 CI 红。
- **`continuityPreview` 与正文彻底脱钩后可能无人维护** → 只读区仍由 `transitionContinuityBlock` 驱动，其推导规则有独立测试覆盖（`衔接块引用两镜完整正文，不含省略号`），不会腐化。

## Migration Plan

无数据迁移。部署即生效。

回滚：还原 `buildTransitionVideoPreview` 的 prompt 赋值与两个函数即可，`generated` 与 `videoMeta` 均未被改写，回滚无残留。

## Open Questions

无。
