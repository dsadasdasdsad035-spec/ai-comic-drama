# Design: shot-prompt-agent-authored

## Context

动机见 `proposal.md - Why`。当前实现的关键事实：

- `buildShotVideoRequest` 是画布出片请求的唯一拼装入口（`src/videoPrompt.ts:304`），预览与请求共用。
- 正文分两个阶段：先定「底座」（`video_prompt` → `prompt` → `shotAutoScriptPrompt` → `fallback`），再把七段指令块追加到末尾（`appendShotDirectives`）。
- `SHOT_CONSTRAINTS_DIRECTIVE`（`videoPrompt.ts:261`）无条件追加，文本与任何字段无关。
- `APPEND` 阶段有跳过机制 `DIRECTIVE_PRESENT`：底座里已含 `【运镜】`、`【台词】`、`无字幕` 等标记时跳过对应块。这是目前唯一的退出通道，无 UI 提示。
- 服务端还有两处追加：`server/app.ts:6207` 在正文为空时注入硬编码文案，`server/app.ts:6211` 在有视频参考且正文无 `@视频1` 时追加范围约束。
- `buildShotPromptRenderBundle` 被 `read_prompt_render_bundle` 工具消费，是 Agent 的**输入材料**；`assembleShotPromptScript` 是运行时的**输出拼装**。两者当前在同一文件里，共享 bundle 结构。

## Goals / Non-Goals

**Goals**

- 正文来源在代码上只剩一次赋值，读代码时不需要判断「这段是谁加的」。
- 让「字段 → 正文」的转换完全发生在 Agent 的推理里，可被 prompt 迭代、可被人手改。
- 补齐 Agent 读取出片输入的最后一环（参考图顺序），使 Agent 有能力写出与请求一致的映射。

**Non-Goals**

- 不改出片面板的提交目标展示与 `video_meta` 记录（保留 `2f13ea4` 的这一部分）。
- 不改参考图的收集规则、上限与互斥判断（`collectShotComposerRefs`、`limitVideoReferenceImages` 保持不变）。
- 不删除 `buildShotPromptRenderBundle`（工具输入）。
- 不删除 `performanceDirectionText` / `nativeAudioPrompt`（可复用文本工具，转场也在用）。
- 不引入「自动追加开关」。开关会让「正文到底含什么」多出一维状态，与本次要消除的歧义相反。

## Decisions

### D1：正文一次赋值，删掉第二个阶段

`buildShotVideoRequest` 中把两个阶段压成一次：

```ts
const prompt = (d.videoPrompt || '').trim()
```

`effectiveVideoPrompt` 保持不变（手改优先，逐字发送）。`textSource` 从三档塌为两档语义：有值即 `video_prompt`，无值即阻断。

**替代方案：保留 `appendShotDirectives` 但传空数组。** 否决。函数会退化成恒等，却仍占着「追加方向性指令」的名字，下一个人加需求时最自然的动作就是往里塞一段。

### D2：空正文阻断而非回落

新增 blocking code `shot-prompt-empty`，与转场的 `transition-prompt-empty` 同构。放在 `buildShotVideoRequest` 的 blocking 数组里，由 `generateVideoOne` 现有的 `request.blocking[0]` 逻辑自动拦截，不需要改调用方。

**替代方案：保留 `prompt`（首帧正文）作为回落。** 否决。那是另一个字段的语义，不是出片正文；回落会再次产生「我写 A 却发了 B」。

### D3：`buildShotPromptRenderBundle` 留，`assembleShotPromptScript` 删

分界线是「这份文字流向谁」：

```
buildShotPromptRenderBundle ──> read_prompt_render_bundle 工具 ──> Agent 读
assembleShotPromptScript    ──> 请求 prompt              ──> 视频模型
```

前者保留，后者删除。`shotAutoScriptPrompt` 只是后者的包装，一并删除。删除后 `promptRender.ts` 里 bundle 的 `continuity` / `endFrame` 默认文案仍保留 —— 它们是 bundle 字段，Agent 读得到，只是不再被运行时展开成句子。

### D4：新增 `read_shot_video_inputs` 工具

返回 `ShotVideoRequest` 去掉 `prompt` / `fingerprint` / `warnings` / `blocking` 之后的部分：

```ts
{
  mode,              // 'first' | 'ref' | 'video' | 'native'
  seconds,           // 请求秒数
  shotSeconds,       // 镜头秒数
  refs: [{ index, label, purpose, slot, url }],   // 按提交顺序
  omitted: [{ label, reason }],
  omittedVideos: [{ label, reason }],
  video: { label, url } | null,
  audio: { label, url, character } | null,
}
```

实现上直接复用 `buildShotVideoRequest`，只做投影。这样顺序、上限、互斥、表情参考替换全部与出片请求同源，不会漂移。

**替代方案：把这段信息塞进 `read_shot_video_prompt`。** 否决。那个工具的语义是「最终正文是什么」，而这是「正文之外送什么」。混在一起会让「未写正文时该返回什么」变得含糊。

**替代方案：让 Agent 从 `refIds` 自己推顺序。** 否决。顺序由去重、表情参考替换、上限截断共同决定，Agent 复现必然漂移，映射错了比不写更糟。

### D5：服务端删除两处兜底

- `server/app.ts:6207`：`String(body.prompt || '').trim() || '镜头缓慢推进…'` → 改为空则抛 `ApimartError('提示词为空', { kind: 'bad-request' })`。`apimart.mjs:405` 已有同样的校验，这里提前到入口，错误消息更明确。
- `server/app.ts:6211`：删 `videoRefScopeSuffix` 与 `withVideoRefScope`，直接使用 `prompt`。

注意：`buildVideoPayload` 不接收 `prompt` 之外的兜底逻辑，所以删完后服务端对正文完全透明。

### D6：指纹保持现状，只清理失效引用

初稿曾考虑把 `size`、`move`、`motionNote`、`dialogue`、`performance` 从 `fingerprintOf` 移除，理由是它们不再影响正文。**重新审视后否决**：在 Agent 写正文的模型下，这些字段恰恰是 Agent 的输入材料，用户改了运镜却不改正文时，把「旧快照」提示出来才是有用的提醒 —— 它表达的是「输入变了，正文可能该跟着变」。移除反而会掩盖该提示。

因此 `fingerprintOf` 的字段集合保持不变。只需清理两处因删除而失效的引用：`motion` 计算里的 `pTrim` 与 `fallback`（`videoPrompt.ts:369-377`），改为只取 `video_prompt`。

### D7：Inspector 字段加说明，不加自动补入

这些字段失去正文通道后，用户改它会「没反应」。面板在「运镜与语义」「表演」「台词」「原生音频」四处加一行说明：字段不进入出片正文，需在创意会话中由 Agent 组织，或直接写入运动提示词。

**不使用「一键补入正文」按钮。** 那是运行时生成文字的另一副面孔 —— 点一下依然得到系统拼的句式，只是换了个触发者。真正符合原则的路径是让 Agent 读字段后自己写。

## Risks / Trade-offs

- **「调了没用」的抱怨会回来** → 这是原则性代价。缓解：四处说明文案写清「字段是给创意会话的输入，不是正文来源」；技能文档补充「写正文前先读 `read_shot_video_inputs` 与 `read_shot_detail`」。
- **存量空正文分镜升级后无法出片** → 改为阻断而非静默降级，用户会立刻看到并补写。属预期，需在变更说明里写明。
- **`【约束】` 消失后可能出现字幕/水印** → 无水印已由 `watermark: false` 参数保证（`server/apimart.mjs:413`、`500`）。字幕与身份漂移失去唯一防线，依赖 Agent 在正文里自行写明。这是必须接受的取舍。
- **参考图映射依赖 Agent 自觉调用新工具** → 若 Agent 不调用，多图参考回退到无语义锚点（图片仍按顺序提交，模型只见 URL 列表）。属可接受降级，不会报错。
- **`DIRECTIVE_PRESENT` 的隐藏逃生口一并消失** → 此前用户可在正文手写 `无字幕` 来抑制约束段，这个未文档化的行为没了。由于约束段整体删除，不影响任何现有提示词。
- **`resolveShotVideoPrompt` 的读工具语义变化** → 它当前有 `keyframe_prompt` 回退与 `script_assembled`（`requiresCanvas: true`）两个分支。删除回退后，空正文的语义从「需要画布拼装」变成「被阻断」，读工具必须返回 `blocked` 而非 `requiresCanvas`，否则 Agent 会以为还能补齐。
- **测试大面积反转** → `tests/performance-video-prompt.ts`、`tests/shot-read.ts`、`verify-prompt-render.mjs` 里大量断言验证追加段与脚本拼装存在，需逐条改为反向断言。这是本次工作量的大头。

## Migration Plan

无数据迁移。`video_prompt` 字段未变，旧值照常使用。

升级影响：`video_prompt` 为空且 `prompt` 非空的分镜，此前靠 `prompt` 回退出片，升级后被阻断。需补写一次 `video_prompt`。

回滚：恢复 `appendShotDirectives` 调用与服务端两处兜底即可，数据未改写，无残留。

## Open Questions

无。
