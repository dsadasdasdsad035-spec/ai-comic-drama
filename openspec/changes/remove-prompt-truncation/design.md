# Design

## Context

提示词正文在到达模型之前会经过三处独立的分层，每层都附带一套自己的字符预算：

```
用户/Agent 写入 (generated.prompt)
      |
      +-- 语义层   semanticTransitionVideoPrompt   transitionGen.ts
      |             └─ 空正文 → defaultTransitionPrompt → cutPromptSnippet(90)
      |
      +-- 模板层   buildTransitionPromptRenderBundle  promptRender.ts
      |             └─ scene.environment  .slice(0, 300)
      |
      +-- 注入层   finalizeTransitionPromptText       transitionGen.ts
                    └─ 仅追加结构锚点（衔接块只在面板预览里出现）
```

单镜侧同构：`buildShotPromptRenderBundle` 的 `scene.environment` 取 `d.prompt.slice(0, 200)`，`castStates` 在无表演数据时取 `d.prompt.slice(0, 120)`。

读取侧另有一层：`boundJson`（8000）、`shrinkResult`（4000）、`MATERIAL_CODE_MAX`（20000）、`LIST_BUDGET`（8000）/ `SHOT_LIST_BUDGET`（24000）与 `SINGLE_RECORD_BUDGET`（12000）。前三者切字符串，后三者只按整条跳过并给游标——两者性质不同，必须分开处理。

约束来自既有 spec：`chat-agent-runtime` 要求工具结果把「模型可见」与「界面可见」分离，且模型可见内容 MUST NOT 包含整段代码正文。因此白模代码折叠不是「显示限制」，而是运行时契约，本变更不动它。

## Goals / Non-Goals

**Goals:**

- 删除会改变提示词正文的所有固定字符切片，让面板、落库与请求三者逐字一致
- 把「正文为空」从静默兜底改为显式状态，避免用超长兜底掩盖未填写
- 把读取侧的字符折叠统一替换为「按条装填 + 显式标记」

**Non-Goals:**

- 不修改 `engine.ts` 的 `maxTokens: 12000`：撞上限时以 `finishReason='length'` 明确报错，删掉只会让渠道静默默认值接管
- 不修改 `sceneCodePrompt.ts` 的 28000 与 `MATERIAL_CODE_MAX`：这是模型上下文预算与 `chat-agent-runtime` 的代码可见性契约
- 不修改纯显示摘要（`OutgoingVideoPromptPanel` 的 72 字符 peek、`sessionStore` 的 24、`IntakeDialog` 的 1200、`subtitles` 的尾字回退、`mediaBrief`、`storyboardMarkdown` 的文件名 60、`skills/parse` 的 hint 80）
- 不新增设置项，不做「可配置截断长度」

## Decisions

**1. 直接删除切片，不引入替代长度参数**

`cutPromptSnippet` 的两处调用改为直接使用完整字符串；`promptRender` 的两个 `environment` 与 `castStates` 去掉 `.slice`。理由是这些字段的来源本身已经有界（镜头提示词是单镜正文，不是整集文本），再叠加一层固定阈值只会制造信息损失，且损失不可见。

考虑过的替代方案：把 90 换成 400、把 200 换成 800。否决理由——阈值依然会切在句子中间，问题只是往后挪，而且需要为每种输入重新调参。

**2. 空正文改为 `blocking` 或者明确的 `warn`，不再静默兜底**

`semanticTransitionVideoPrompt` 当前实现是 `g.prompt.trim() || defaultTransitionPrompt(...)`。改为：正文与手改正文都为空时，`buildTransitionVideoPreview` 的 `blocking` 增加一条 `transition-prompt-empty`，`defaultTransitionPrompt` 保留为「用户点补写时的预填建议」，但不再参与出片拼装。

考虑过的替代方案：保留兜底，但在面板顶部标「正文由系统推导」。否决理由——用户已经明确要求「删掉限制」，而兜底本身在正文为空时产出的是两条完整分镜正文的拼接，语义上是错的（把两个镜头的完整动作描述塞进一个 1.2 秒接缝），此前靠 90 字符切片才勉强能看。

**3. 衔接块要么真正注入正文，要么从面板移除**

现状与 `shot-transition-continuity` 不一致：spec 要求衔接约束追加进自动正文，代码只把它当预览。本变更选择**注入**，因为 spec 已经存在且是 MUST。

注入点选 `finalizeTransitionPromptText` 而不是 `semanticTransitionVideoPrompt`，理由是前者已经承担「自动路径的尾部追加」职责（结构锚点），且它明确在 `source === 'override'` 时直接返回，天然满足手改优先。

**4. 读取侧统一走 `packRecords`，删除字符串级折叠**

`boundJson` 的唯一实质用途是 `read_prompt_render_bundle` 的 8000 字符上限。bundle 是提示词结构，不是代码，不受 `chat-agent-runtime` 的代码可见性约束，因此改为整份返回。`shrinkResult` 与 `threads.ts` 的 code>2000 折叠属于**历史消息持久化**，不是模型可见结果，保留但补注释说明其用途边界。

`read_shot_video_prompt` 现在只回 `templateRenderedChars`。改为回 `templateRendered` 全文，与 `read_shot_detail` 的「整条给出」一致。

## Risks / Trade-offs

- [九段模板渲染正文显著变长，可能触及渠道上下文上限] → 撞上限时以 `length` 错误结束并保留已流出正文；不做静默裁剪
- [Agent 单次读回 bundle 全文后上下文被挤占] → `packRecords` 已有 `oversized` 标记与游标续读机制；必要时在调用侧按需读取子字段
- [删除兜底后，旧项目里正文为空的历史接缝会立刻变成「未填写」] → 这是预期行为；面板提供「用上下镜正文预填」按钮，一次点击补齐
- [已落库的 `renderedPrompt` 因输入变化指纹失配] → 面板原本就显示「旧快照」，用户重渲染即可；无需数据迁移
- [`charExtract` / `designExtract` / `visualBrief` 去掉切片后，提示词变长] → 这些是给 LLM 的抽取上下文，变长只影响成本不影响正确性；`visualBrief` 仍保留结构上限（`subjects` 8 条、`visible` 12 条），删的是字段内字符数

## Migration Plan

1. 先删 `transitionGen.ts` 与 `promptRender.ts` 的切片，跑 `verify-transitions-ui.mjs` 与相关单测
2. 再把空正文改为 blocking，同步更新面板文案
3. 最后处理读取侧与抽取侧；每步独立可回滚
4. 回滚策略：三组改动互不依赖，任一组回滚不影响其余

## Open Questions

- 衔接块注入后，是否需要在面板里保留那份只读预览？当前倾向保留（它现在是正文的子集），但若正文已经包含，预览会重复显示。留待实现时按可读性决定。
