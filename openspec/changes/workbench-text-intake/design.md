# Design

## Context

参见 `proposal.md` — Why。当前实现约束：

- 三个工作台都已通过 `WorkbenchChatAdapter.applyDraft(payload)` 接收契约形状的草稿，返回 `{ ok, summary, counts }`；回执卡（`src/agent/stageToolUis.tsx`）已经渲染 `added / updated / kept / skipped / sceneFallback` 等计数。导入不需要新的预览组件。
- 契约校验已有统一入口：`assertSkillOutput(contractId, raw)` → `validateContract`（`src/skills/contracts.ts`）。契约注册表含 `script-v1`、`shots-v1`、`prompts-v1`。
- 技能系统通过 `skills/<id>/SKILL.md` 提供 frontmatter + 角色层 + 任务模板；`src/skills/registry.ts` 把内置文本以 `?raw` 挂载，服务端 `/api/skills` 可覆盖正文。技能的 `stage` 决定用哪个环节模型（`resolveStageModel`），因此新增技能不需要新 `Stage`。
- `Stage` 是 10 值联合类型，散落在 45 处（设置页 `STAGE_META`、`STAGE_RUNTIME`、模型选择器等），新增一个环节的代价远高于新增一个技能。
- 五个合并函数的「缺席」语义不一致：`mergeScriptDraft` 按集号保留、`mergeGenerated` **丢弃**、`mergePromptDraft` 保留但两字段一起写、`mergeDesigns` 旧值优先、`mergeCharacters` 非空即跳过。它们是为「LLM 重新生成」设计的。
- `handEdited` 字段已存在并被 `mergeGenerated` 保护（`src/shotSync.ts`），但提示词表的编辑路径没有写它。
- 服务端 `/api/project` POST：`shots` 按 id 字段级合并、缺席标 `orphan`；`episodes` / `characters` / `assets` 整表替换。
- `/api/text` 请求体上限 40MB；真正的限制是模型上下文窗口。

## Goals / Non-Goals

**Goals:**

- 零模型路径能覆盖「文件就是契约」和「表格能映射」两类真实输入。
- 导入与聊天共用同一条 `applyDraft` 通路，只靠 `mode` 区分语义，不产生第二套写入路径。
- 合并语义可解释：任何一次导入，用户都能在应用前知道哪些行会被改、哪些会被删。
- 手改的内容在任何后续生成中都不会被静默覆盖。

**Non-Goals:**

- docx / pdf / 扫描件解析（本机不能可靠解析，见 proposal 的「不做」）。
- 跨集批量导入剧本以外的产物；提示词与镜头表仍以「当前集」为单位。
- 为导入单独建一套预览 UI 或第二份契约校验。
- 列级 diff 的逐字符高亮。

## Decisions

### 决策 1：`applyDraft` 增加 `mode`，而不是新建导入通路

`applyDraft(payload, mode)`，`mode: 'merge' | 'replace'`，默认 `replace` 保持聊天行为不变。三个工作台的 adapter 内部把 `mode` 透传给各自的合并函数：

```
script : mergeScriptDraft(cur, incoming, mode)
shots  : mergeShotsDraft(cur, built, epNo, mode)
prompts: mergePromptDraft(cur, incoming, epNo, chars, mode)
```

`replace` 分支保持现有代码路径不动（聊天、内置动作完全不受影响）。

替代方案：在导入侧写一套独立的合并与写回。否决理由——写回要处理 `handEdited`、orphan 标记、跨集隔离、草稿脏状态、保存时机，这些逻辑已经在 adapter 里；复制一份必然漂移。

**代价**：三个合并函数都要改，且需要为 `merge` 分支单独补测试。

### 决策 2：新增三个 intake 技能，`stage` 指向目标环节

`script-intake`（stage: `script`）、`shotlist-intake`（stage: `shot`）、`prompt-intake`（stage: `prompt`）。这样用户在设置页为「拆镜」选的模型会自动用于镜头表整理，不需要新的模型配置项。

替代方案 A：新增 `Stage = 'intake'`。否决理由——45 处联动、设置页要加一行、模型选择器要改，收益只是「可以给整理单独配一个便宜模型」。

替代方案 B：把整理并入现有 `script` / `shotlist` / `prompt` 技能，用不同输入区分为两种任务。否决理由——现有技能的任务模板写的是「创作」（拆集、拆镜、写提示词），与「只做结构整理、不许改写」直接冲突；塞进去会让两条提示词互相污染，也会让用户误以为改写是被允许的。

### 决策 3：三个 intake 技能的输出契约复用目标契约

不新增 `*-intake-v1`。整理结果必须直接满足 `script-v1` / `shots-v1` / `prompts-v1`，这样预览与应用两处都不需要第二套校验。

**需要放宽的两处现有约束**（否则手写输入进不来）：

- `buildShotsFromModel` 在有台词角色缺表演条目时直接抛错。intake 路径改为自动补 `{ emotion: 'neutral', intensity: 3, speaks: true }` 并计入预览的「自动补全」计数；**聊天路径保持抛错**，因为那是模型的失职。
- `prompts-v1` 要求 `keyframe_prompt` 与 `video_prompt` 都 `min(1)`。导入解析器在进入契约前只提交文件里给了值的字段；单列导入因此不触发该契约，而是走「部分更新」分支（只写单列）。

替代方案：新增宽松契约 `prompts-intake-v1`。否决理由——两套契约意味着两套校验和两条分支，而「只填一列」在现有 `ProjectShot` 里本来就是合法状态（字段可选）。

### 决策 4：表格映射用固定别名表，不用模糊匹配

表头别名表放在 `src/intake/`，中英文各一组，命中即映射，未命中列忽略并计入「忽略 N 列」。不做编辑距离或语义相似匹配：错配一列（比如把「台词」映射成「描述」）的代价远大于少映射一列。

必需列只有镜号。其余列缺失即留空，不用默认值填充——否则预览里无法区分「用户没写」和「系统编的」。唯一例外是结构上必须有值的字段（如运镜）：填默认值时必须计入「默认补全」并单列显示。

**用真实资料包校准后的别名与值形态**（`github.com/dsadasdasdsad035-spec/cat`）：

| 真实表头 | 映射到 | 值形态与处理 |
|---|---|---|
| `镜头` | `no` | 纯数字 `01`，需要补前导格式 |
| `时间` | `seconds` | **区间** `00-05` / `0–5秒` / `5—11 秒` → 结束减开始 |
| `景别/机位` | `size` + 补充说明 | 自然语言「极近景，猫眼」「低机位远景」→ 归一化到枚举，剩余文字保留 |
| `画面与动作` | `desc` | — |
| `台词/声音` | `dialogue` + 声音说明 | 混排旁白、音效、音乐、台词，必须拆 |
| `制作方式` | 忽略 | AI / 实拍 / 实拍+后期 在镜头数据里没有字段 |
| `旁白/声音` | `dialogue` 别名 | 同 `台词/声音` |
| `秒` | `seconds` | 直接是时长 |

这张表说明两件事：**列名不可枚举**（真实表格用的是「画面与动作」而不是「描述」），**单元格内容不是干净的枚举值**（景别是自然语言、时间是区间、台词混着音效）。所以映射层必须分成「列映射」和「值归一化」两层，后者是独立的、可单测的纯函数集合。

### 决策 4b：值归一化独立于列映射

三个纯函数：`parseDuration('17–23秒') → 6`、`normalizeSize('低机位远景') → { size: '远景', note: '低机位' }`、`splitDialogueCell('脚步声停止。人类轻声：小家伙，你怎么在这里？') → { lines: [...], sounds: [...] }`。

破折号统一：`-`、`–`、`—`、`~` 全部视作区间分隔符。

台词的判定规则：单元格里按 `说话人：` 模式切分。没有 `说话人：` 前缀的文字段落归入声音说明。`旁白` / `画外音` / `OS` 识别为旁白说话人，不进 `cast`，因为 `collectShotReferences` 会按 `cast` 找角色卡，把旁白塞进去会导致找不到角色的静默降级。

`normalizeSize` 只在能唯一确定时归一化。`极近景` → 大特写、`中近景` → 近景、`低机位远景` → 远景都是唯一解；`猫咪主观镜头` 没有景别词，必须留在「未识别」而不是猜一个。

### 决策 5：场次回退从静默计数改为可解释项

`buildShotsFromModel` 在 `scene_no` 找不到时回退到第一场并累加 `sceneFallback`。导入预览把该计数翻译成「N 镜的场次号在当前集不存在，将归入第 X 场」，并列出来源场次号。不改成报错，因为手写表格的场次编号习惯与项目内编号经常不一致，硬失败会让这条路径不可用。

### 决策 6：导入一律先合并出全集再提交

服务端 `mergeShots` 会把 payload 里缺席的镜头标 `orphan`。导入必须先合出完整镜头集合（含其他集）再提交，否则「补三镜」会静默清空整集。这条是硬约束，写在 tasks 的验收里。

### 决策 7：提示词表编辑补 `handEdited`

`PromptTable.edit` 目前在改字段时只 `setDirty(true)`。改为同时把字段加入 `handEdited`，与 `ShotTable.edit` 一致。生成路径已有 `mergeGenerated` 的保护逻辑，补标记后自动生效。

### 决策 8：超长文本按结构标记切块，无标记则拒绝

正则识别「第 N 集」「第 N 场」「场景 N」等标记切块，逐块整理并逐块契约校验，全块成功后合并为一次预览。没有标记时直接拒绝。不做截断——截断会静默丢内容，而用户无法从预览里看出丢了什么。

## Risks / Trade-offs

- **`merge` 与 `replace` 并存增加理解成本** → 两个入口的文案必须显式说明语义：导入默认为「只改动文件里出现的行」，聊天不动；替换选项在预览里显示将删除的行数。
- **导入后用户以为是全集** → 预览必须显示「本次涉及 N 镜 / 该集共 M 镜」，让缺口可见。
- **自动补表演条目可能掩盖真实的表演缺失** → 只在 intake 路径补，且计入预览计数；聊天与生成路径仍报错。
- **表格别名表覆盖不到用户的自定义表头** → 预览的「忽略 N 列」必须列出被忽略的列名，让用户知道该改表头还是让模型整理。
- **模型整理会改写** → 技能模板写死「只做结构整理」并在预览里对比原文与整理结果的字数；字数明显增加时提示可能被扩写。
- **长文切块后各块之间的集号/场号不连续** → 合并前按集号去重，冲突时以先出现的为准并在预览里报告。

## Migration Plan

无数据迁移。`handEdited` 字段已存在，新写入路径只是更频繁地使用它。

行为变化对已有项目的影响：无。`applyDraft` 默认 `replace`，聊天与内置动作行为不变。

回滚：删除三个技能文件与导入入口即可，不涉及数据格式。
