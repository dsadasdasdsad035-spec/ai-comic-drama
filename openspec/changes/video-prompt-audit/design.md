# Design

## Context

- 视频正文来源：`src/videoPrompt.ts:418` 明确「正文只来自人/Agent」——`vpTrim` 为空即 `shot-prompt-empty` 阻断，没有脚本拼装或硬编码兜底。所以审计对象是一段自由中文文本，不是结构化字段。
- 契约现状：`src/skills/contracts.ts` 的 `prompts-v1` 只做 `z.string().min(1)`，实测 `"画面"`、`"x"`、无景别运镜的句子均通过。`shots-v1` 已用 `superRefine` 做跨字段拒绝（禁 `keyframe_prompt` / `video_prompt` 混入），审计钩子可沿用同一位置。
- 既有审计模式：`src/promptAuditCore.mjs` 是纯函数、无 React/浏览器依赖，被 `src/promptAudit.ts`（浏览器）与 `server/db.mjs`（项目健康统计）同时消费；`.d.mts` 提供类型。这是要复用的形态。
- 词表可用：`public/presets/camera-moves-whitebox-132/manifest.json` 的条目带 `mapsToMove`（推/拉/摇/移/升降/跟/手持）与 `mapsToSize`（大特写/远景/全景/中景/特写）；`src/cameraLexicon.ts` 已解析该 catalog。
- 数据字段：`ProjectShot` 有 `dialogue` / `cast` / `performance` / `size` / `move` / `seconds` / `scene_slug` / `desc` / `video_prompt` / `audio_mode` / `audio_ref` / `clip` / `transition_out`；场次 `beats` 在 `episodes[].scenes[]`。参考集由 `src/shotReferences.ts` 的 `collectShotReferences` 解析。
- 模板占位：`src/promptRender.ts:262` 的 `endFrame.subjectPose` 硬编码为 `'与动作结束状态一致'`，是占位检查要抓的真实样本。

## Goals / Non-Goals

**Goals:**

- 一套纯函数审计核，返回 `checks[]`，Agent 写回 / 画布面板 / 服务端统计共用。
- `applicable` 与 `ok` 严格分离，杜绝「本镜不需要」被当成「没写」。
- 硬项阻断可执行：失败回执自带 `evidence` + `hint`，Agent 无需二次查询即可重写。
- 判定可解释、可回归：每项都有正反例纯函数测试，不依赖 dev server。

**Non-Goals:**

- 不引入 LLM 判分，不把正文送模型做「写得好不好」。
- 不改 `video_prompt` 的自由文本形态，不引入分段模板。
- 不改出片拼装、参考解析、预览一致性、手改快照（属 `shot-video-prompt` / `prompt-text-integrity`）。
- 不改 `skills/` 的 `VID-*` 编号；应用侧用独立的 `checks[].id`。

## Decisions

### 1. 审计核放在既有 `promptAuditCore.mjs`，不新开模块

**决定**：在同一文件扩展 `auditVideoPromptCore`，与 `auditKeyframePromptCore` 并列；`promptAudit.ts` 增加浏览器入参映射。

**理由**：已有「一份判定、两个消费点」的成熟形态与服务端复用；新开模块会让首帧/视频两套锚点口径分叉。文件名不变，避免动 `server/db.mjs` 的 import 路径。

**备选**：新建 `videoPromptAuditCore.mjs`。否决——首帧与视频都要查角色锚点，分文件必然重复 `lookEn` 匹配逻辑。

### 2. 三级判定用结构化对象，不用错误字符串数组

**决定**：

```ts
type AuditCheck = {
  id: string                 // 稳定 id，如 'ambient-sound'
  level: 'error' | 'warn'
  applicable: boolean
  ok: boolean
  evidence?: string
  hint?: string
}
type VideoPromptAudit = {
  checks: AuditCheck[]
  blockers: AuditCheck[]     // applicable && !ok && level === 'error'
  warnings: AuditCheck[]     // applicable && !ok && level === 'warn'
}
```

**理由**：`applicable=false` 必须在结果中显式存在（便于测试与 UI 展示「本镜不涉及」），但不得进入 `blockers`。若只返回失败项，测试无法区分「跳过了」与「漏了」。

**备选**：返回 `{ errors: string[], warnings: string[] }`。否决——丢失 `applicable` 语义，也无法逐项回归。

### 3. 23 项检查的判定细则

**A 结构完整性**

| id | level | applicable 条件 | ok 判定 |
|---|---|---|---|
| `size-declared` | error | `size` 非空 | 正文命中 `mapsToSize` 词表或同级同义（如「中近景」含「中景」） |
| `move-declared` | error | `move` 非空 | 正文命中 `mapsToMove`；`move=固定` 时命中「固定/不动/机位稳定/构图不变」 |
| `action-chain` | error | 恒适用 | 正文含至少一处「主体 + 动作动词」片断；纯静态/氛围判否 |
| `placeholder-free` | error | 恒适用 | 不含占位串（`与动作结束状态一致`、`待补充`、`TBD`、`xxx`） |

**B 结尾衔接（首发 warn，见 Decision 7）**

| id | level | applicable | ok |
|---|---|---|---|
| `ending-state` | warn | 恒适用 | 正文尾段含终点语义（定格/停在/最终/落在）+ 姿态或持物 |
| `handoff-consistency` | warn | 存在下一镜 | 本镜终点持物/姿态与下镜起手不矛盾 |

**C 表演与声音**

| id | level | applicable | ok |
|---|---|---|---|
| `lip-sync` | error | `dialogue` 非空 | 正文含口型/说话/发声/张嘴类描写 |
| `voice-consistent` | error | native 模式且有台词 | `audio_ref.character` ∈ 说话人集合 |
| `audio-ready` | warn | 有台词且无成片 | 静态音轨已有 TTS 或 native 音轨 |
| `performance-action` | warn | `performance[].action` 非空 | 正文覆盖该角色的动作 |
| `ambient-sound` | error | beats/desc 命中天气或环境音事实 | 正文含对应拟声或底噪描写 |
| `perf-diversity` | warn | `cast.length >= 2` | 各角色描述不完全共用同一情绪词 |

**D 参考一致性**

| id | level | applicable | ok |
|---|---|---|---|
| `cast-anchor` | error | `cast` 非空 | 复用 `lookEn` 匹配（与首帧审计同逻辑） |
| `scene-ref` | warn | `scene_slug` 非空且有场景卡 | 参考集含场景条目 |
| `prop-ref` | warn | desc 提及道具卡名 | 参考集含该道具 |
| `ref-described` | warn | 参考集非空 | 正文含参考/依照/沿用/保持类说明 |
| `mode-matched` | error | 恒适用 | 引用式表述 ↔ 参考集非空；自足式描述 ↔ 可为空 |

**E 生成风险**

| id | level | applicable | ok |
|---|---|---|---|
| `duration-fit` | warn | 正文含标秒分段 | 分段合计 == `seconds` |
| `camera-conflict` | warn | 含标秒分段 | 同一时段不同时出现固定与移动 |
| `multi-person-blocking` | warn | `cast.length >= 2` | 正文含站位或左右关系说明 |
| `fight-rounds` | warn | desc/beats 命中打戏词 | 正文按回合或标秒分段 |
| `text-risk` | warn | 命中画面文字风险物（招牌/屏幕/纸页） | 正文含防乱码或字样说明 |
| `physically-risky` | warn | 命中高损耗动作词 | 已改写或已给构图化解 |
| `dialogue-fidelity` | error | 正文含引号或标签发声引文 | 引文出现在剧本/视觉设定/分镜定稿 |

### 4. 词表：派生为主，小词表为辅

**决定**：`SIZE_TERMS` / `MOVE_TERMS` 在模块初始化时从 `cameraLexicon` catalog 的 `mapsToSize` / `mapsToMove` 去重派生，不硬编码。其余 `WEATHER_TERMS` / `SFX_TERMS` / `LIP_TERMS` / `ENDING_TERMS` / `FIGHT_TERMS` / `TEXT_RISK_TERMS` / `RISKY_ACTION_TERMS` 写在一处常量表。

**理由**：景别运镜是项目已有枚举，硬编码一份必然漂移（模型写「中近景」而词表只有「近景」）；天气音效在 `VID-*` 里没有枚举，只能自建。

**风险**：`promptAuditCore.mjs` 是纯函数、不 import JSON——派生逻辑放进 `src/promptAudit.ts` 的入参映射（浏览器侧传入词表），核心只接受 `vocab` 入参。这样服务端也能传入自己的词表快照。

### 5. 阻断点在 `prompts-v1` 校验之后

**决定**：`src/skills/contracts.ts` 的 `prompts-v1` 增加可选 `audit` 上下文；schema 通过后逐镜审计，任一 `blockers` 非空则整体失败并返回 `checks[]`。

**理由**：schema 只保证形状，审计保证内容；两者分开便于单测。放在同一函数里可以一次返回所有问题，Agent 不必猜。

**备选**：在 Agent 工具层拦截。否决——契约层是唯一写入口，工具层拦不住其他写入路径。

### 6. 失败回执形状

```jsonc
{
  "ok": false,
  "error": "video_prompt_audit_failed",
  "checks": [
    { "id": "ambient-sound", "level": "error", "applicable": true, "ok": false,
      "evidence": "场次 EP001-SC001 beats：暴雨。更鼓敲过三响",
      "hint": "补写雨声、雷声与地面积水回响" }
  ]
}
```

Agent 在同一次 tool-call 循环里读到后重写再提交，不新增修复工具。

### 7. `ending-state` / `handoff-consistency` 首发只 warn

**决定**：这两项依赖中文语义推断（什么算「终点姿态」），误报率显著高于词表类检查。首发 `warn`，在真实项目跑一轮并统计误报后，才允许提升为 `error`。

**理由**：硬项阻断的代价是 Agent 卡在无法满足的检查上反复重写；语义类检查在没有样本前不值得付这个代价。

### 8. `applicable` 为假时也必须出现在 `checks`

**决定**：`checks` 包含全部 23 项，`applicable: false` 的原样列出。

**理由**：UI 需要展示「本镜不涉及口型」，测试需要断言「跳过而非漏判」。只在内部过滤会让两种情况无法区分。

### 9. 参考集由调用方解析后传入

**决定**：审计核心不自己调 `collectShotReferences`，而是接受 `refs: { kind, name }[]` 摘要。浏览器侧、Agent 侧、服务端各自按已有方式解析后传入。

**理由**：`collectShotReferences` 依赖画布节点与 `missingMedia`，服务端没有这些；核心保持纯净才能三处复用。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 中文无词边界，景别「中近景」不被「中景」命中 | 词表匹配用「包含」而非「相等」，并对「中近景/中全景」加别名 |
| 语义类检查误报导致 Agent 反复重写 | `ending-state` / `handoff-consistency` 首发 warn；其余 error 项全部基于词表与字段事实 |
| 词表漏词导致漏报（假阴性） | 漏报比误报安全（不会卡住 Agent）；先用现有项目跑一遍统计覆盖率再补词 |
| 环境声词表覆盖不到某些拟声（如「蝉鸣」） | 词表给到 40 条量级并允许调用方注入扩展 |
| 服务端缺场次 beats 时无法判定环境声 | 缺输入时该项 `applicable: false`，不报错 |
| 23 项一次全开会显著拉长写回回执 | 回执只列 `applicable && !ok` 的项；通过项不逐个回传 |
| 硬项阻断可能让已有不合规项目无法再写提示词 | 只在新写入时阻断；读取、出片、已有数据不受影响 |

## Migration Plan

1. 扩展审计核 + 词表 + 纯函数测试（不接任何入口，可独立验收）。
2. `promptAudit.ts` 增加浏览器映射，画布面板先只读展示（不阻断）。
3. `prompts-v1` 接入阻断，先只对 `error` 项；观察一轮真实 Agent 写回。
4. 视误报情况调整 `ending-state` / `handoff-consistency` 等级。
5. 回滚：`prompts-v1` 的审计钩子为可选入参，不传即回到纯 schema 校验。

## Open Questions

- `ending-state` 的「终点姿态」阈值：正文尾段取多少字符窗口（建议尾段最后 80 字，待真实样本校准）。
- `perf-diversity` 的「同质化」判定：共用情绪词达到几个才报（建议 2 个角色以上共用同一情绪词即 warn）。
- 是否需要在画布 Inspector 显示审计结果（P1）；本变更 P0 只保证工具层阻断。
