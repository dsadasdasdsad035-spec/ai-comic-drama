# Design

## Context

动机见 `proposal.md - Why`。影响实现的关键现状：

- `buildShotVideoRequest`（`src/videoPrompt.ts`）已是出片请求唯一拼装入口，正文在 4a5b79b 后收为单次赋值 `(d.videoPrompt || '').trim()`，空值以 `shot-prompt-empty` 阻断。
- `effectiveVideoPrompt`（`src/videoPrompt.ts:478`）当前实现「手改快照 override 优先，否则 `request.prompt`」，并给手改记录 `fingerprint`，供「旧快照」判断。
- 正文编辑有两处：`Inspector.tsx` 的 `motionPrompt` 折叠区（`textarea` → `videoPrompt`），和 `OutgoingVideoPromptPanel` 的手改编辑（→ `videoPromptOverride`）。
- `video_prompt` 已有稳定的落库/同步链路：`shotSync.ts` 双向映射、`prompts-v1` 契约唯一可写字段之一、`SHOT_IMPORT_FIELDS` 已包含。
- `handEdited` 的保护机制已存在：`mergeGenerated`（`shotSync.ts:11`）按锁定字段回填旧值，`SHOT_FIELD_POLICY.agent` 不含提示词列（提示词只走 `submit_prompts` / 专用写工具）。
- `video_prompt_override` 的写入点共 3 处：Inspector、`set_shot_video_override` 工具、`shotSync.ts` 的 agent 可写清单。
- `video_prompt_rendered` 无任何运行时消费者，仅存档与读工具回显。

## Goals / Non-Goals

**Goals:**

- 让「用户看到的正文」与「请求里的正文」之间不再有两个字段可选。
- 用既有 `handEdited` 机制替代 `video_prompt_override` 的保护职责，不引入新锁机制。
- 存量数据零丢失：已有 override 的镜头升级后出片内容逐字不变。

**Non-Goals:**

- 不恢复任何自动拼装、首帧回退或模板渲染路径。
- 不改变参考图/视频/音色收集规则与上限。
- 不改 `submit_prompts` 契约与 `prompts-v1` 字段集合。
- 不迁移或清理存量 `video_prompt_override` 数据（保留只读）。
- 不重做 `videoPromptRendered` 的存档（保留字段，不新增消费）。

## Decisions

### D1：正文写回 `video_prompt`，用 `handEdited` 承担保护

`video_prompt` 已经是镜表正文主体、导出字段与 `prompts-v1` 的必填项；`handEdited` 已有完整的「只增不减 + 生成时回填」链路（`server/db.mjs:1998`、`shotSync.ts:11`）。复用它意味着不新增数据字段、不动同步与落库，只需要在保存正文时追加标记。

替代方案：新建 `video_prompt_edited` 布尔字段。否决——与 `handEdited` 语义重复，且 agent 策略与合并逻辑都要重写一遍。

替代方案：保留 override 字段但停止暴露 UI。否决——这正是 proposal 要消除的双数据源；留着会让 `effectiveVideoPrompt` 继续需要判两个来源。

### D2：`effectiveVideoPrompt` 收敛为「存量快照 → 正文」

```ts
// 旧 override 只读优先，之后一律取 video_prompt
if (override?.text) return { text: override.text, source: 'legacy-override', stale: false }
return { text: request.prompt, source: 'video_prompt', stale: false }
```

`stale` 恒为 `false`：单一正文模型下没有可比较的基线。保留该字段是为了不改 `EffectiveVideoPrompt` 的消费者形状，等后续清理。

替代方案：直接删除 override 分支。否决——会让存量镜头出片内容从「手改全文」突然变成 `video_prompt`，属于静默改写已存数据，违反「零丢失」。

替代方案：读取时把 override 并入 `video_prompt` 做一次性迁移。否决——写库需要迁移脚本与回滚方案，且用户可能仍想看到「这是旧版本」的标记；只读兼容成本更低。

### D3：正文编辑放在 `OutgoingVideoPromptPanel` 内，复用现有 textarea 分支

面板已有 `editing` / `draft` / `startEdit` / `save` 状态机，只需改 `onSaveOverride` 的落点：写 `video_prompt` + `handEdited`，而不是写 override。删除 `effective.stale` 驱动的「重新拼装 / 恢复自动」按钮组和 `onRebuildOverride`。

替代方案：把编辑搬到 `SiReadinessBar` 或新开一个区块。否决——面板已承载附件清单与阻断项，正文与它们同屏才符合「预览与请求一致」的既有要求。

### D4：Inspector 只删正文 textarea，`motionPrompt` 区块保留

`motionPrompt` 折叠区里装了镜号、时长、景别、运镜、正文 textarea 与 `ShotLexiconRefBlock`。只删 textarea，其余字段与区块 id 都留在原位，标题从「运镜与语义」改为「镜头参数」以免继续暗示此处写正文。

保留 section id 的理由：`CollapsibleSection` 的折叠偏好按 id 持久化，改 id 会让用户的折叠状态丢失，且需要同步改类型与读写逻辑；收益只是措辞。

替代方案：并入「出片设置」。否决——会让出片设置区块同时承载镜头结构与模型参数，两个关注点混在一起。

替代方案：整个区块删除。否决——镜号/时长/景别/运镜仍需编辑入口，且镜头语言库必须留在出片 Tab（见 `shot-video-prompt` 的镜头语言库需求）。

### D5：`set_shot_video_override` 保留签名，改为写 `video_prompt`

Agent 侧有技能与专家白名单引用该工具名（`expertToolGroups.ts`、`skills/tools.ts`）。改名会波及 manifest 与技能文档，收益仅为措辞一致。

实现上：`text` 非空时写 `video_prompt` + `handEdited`，忽略 `fingerprint`（保留参数但不再校验，避免调用方失败）；`clear` 时移除 `video_prompt` 的 `handEdited` 标记，并把存量 `video_prompt_override` 置空。

替代方案：直接删除工具。否决——会让已引用它的技能在运行时拿到「未知工具」，属破坏性变更，且没有替代工具能表达「清除人工编辑」。

### D6：字段策略层面只做最小调整

- `SHOT_AGENT_EXTRA_FIELDS` 保留 `video_prompt_override`（存量兼容写回空值需要），但 agent 正常写入不应产生新值。
- `SHOTS_V1_FORBIDDEN_PROMPT_KEYS` 保留 `video_prompt_override`，继续拦 `submit_shots` 夹带。
- `prompts-v1` 不动：它本就只接受 `keyframe_prompt` + `video_prompt`，正是新模型需要的形状。
- `video_prompt` 继续不在 `SHOT_FIELD_POLICY.agent` 白名单内，agent 只能经 `submit_prompts` 或 `generate_clip` 的 `prompt` 参数写它——`handEdited` 锁在这些路径之外仍然生效（`mergeGenerated` 与 `applyShotMerge` 只在合并模型结果时回填）。

### D7：徽章从三种来源收敛为三种状态

| 状态 | 判定 | 文案 |
|---|---|---|
| 人工编辑 | `video_prompt` 在 `handEdited` 中 | 已手改 |
| 普通正文 | 正文非空且未手改 | 正文 |
| 存量快照 | `video_prompt_override` 非空 | 旧版本正文 |

`semantic` / `template` 两个 `autoKind` 取值随拼装层一并消失；`OutgoingVideoPromptPanel` 的 `badgeClass` / `badgeLabel` 分支相应精简。

同时修正 `Inspector.tsx:601` 的 `sourceLabel`：现在用 `request.prompt.trim()` 判断，会在 override 生效时仍显示「正文来自运动提示词」；改为读 `effective.source`。

### D8：测试改写以「单一入口 + 字段锁」为主线

`verify-video-prompt-preview.mjs` 是唯一端到端覆盖手改链路的脚本（9 处断言），改写要点：

- 「运动提示词字段提示不生效」→「运镜与语义无正文输入框」
- 「参考变化后显示旧快照」→「参考变化后正文不变且无过期警告」
- 「重新拼装回到自动拼装」→ 删除；改为「保存后写回 `video_prompt`」
- 新增「保存后 `video_prompt_override` 仍为空」
- 新增「`handEdited` 含 `video_prompt`，重新提交提示词不覆盖」

`tests/shot-read.ts`、`tests/shot-field-policy.ts`、`verify-creative-export.mjs`、`verify-prompt-cases.mjs`、`verify-shot-inspector.mjs` 的 override 断言改为存量兼容语义。

## Risks / Trade-offs

- **存量 override 与新正文并存产生困惑** → 面板在 override 生效时明确标注「旧版本正文」，并提示「保存一次正文即迁移到镜头正文」；一旦用户在正文区保存，override 立即失效。
- **失去「输入变了提醒重写正文」** → 这是收敛单一正文的必然代价。缓解：参考/运镜变化时附件清单与就绪条仍会更新，用户能看到输入变了；是否改正文由人判断，而不再由指纹横幅催。
- **`handEdited` 只增不减导致正文永久锁定** → 用户清除标记的唯一入口是 `set_shot_video_override(clear:true)` 和 Inspector 的对应按钮。需在面板保留一个显式的「交由模型重写」动作，否则用户只能靠 Agent。实现阶段必须为此留入口，否则正文会被永久冻结。
- **存量空正文且无 override 的镜头升级后无法出片** → 与 4a5b79b 的既有阻断一致，不是新增行为；但删除「恢复自动拼装」后用户少了一条逃生路，需确保面板在阻断态仍提供「手改编辑」入口（当前已有）。
- **`motionPrompt` 区块改名影响用户认知** → 区块从「运镜与语义」改为「镜头参数」，老用户可能找不到原来的名字。缓解：保留同一 section id，折叠状态不变；区块内不再有正文框，位置关系仍是「正文在上、镜头参数在下」，与原来一致。
- **测试大面积反转** → 上述 7 个脚本断言需逐条核对，工作量集中在这里。

## Migration Plan

**数据**：无迁移脚本。`video_prompt_override` 保留在库与项目文件中，读取优先、不再写入。

**升级影响**：
- 有 override 的镜头：出片内容不变，面板改标「旧版本正文」。
- 只有 `video_prompt` 的镜头：行为完全不变。
- `video_prompt` 与 override 皆空的镜头：升级前后都被阻断。

**回滚**：恢复 `effectiveVideoPrompt` 的 override 分支与 Inspector 的 `motionPrompt` 区块即可；`handEdited` 里多出的 `video_prompt` 标记不影响旧逻辑（旧逻辑不读它），数据无需回退。
