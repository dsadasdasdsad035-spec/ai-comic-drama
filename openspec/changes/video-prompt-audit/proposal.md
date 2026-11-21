# Proposal

## Why

Agent 写视频提示词目前**没有任何内容质量门**。`src/skills/contracts.ts` 的 `prompts-v1` 只校验 `video_prompt: z.string().min(1)`——实测 `video_prompt: "画面"`、`"x"`、完全没有景别运镜的句子都能通过写回。现有 `src/promptAuditCore.mjs` 只审首帧提示词里的角色 `lookEn` 锚点，不碰视频正文。结果是：剧本写着暴雨雷鸣，提示词可以不写任何声音；有台词可以不写口型；有角色可以不写外观说明；镜头结束在什么姿态也无从检查。技能目录 `skills/short-drama-video-prompts` 有 `VID-01..28` / `CON-01..07` 的完整规则表，但那些编号只存在于纸面文档，应用中没有任何代码消费它们，模型写得好写得差都能交稿。

## What Changes

- **新增视频提示词审计核**：在现有 `promptAuditCore.mjs`（纯函数、浏览器与服务端共用）里扩展出 `auditVideoPromptCore`，从**分镜事实**推导本次该镜「应有哪些项」，逐项返回结构化结果。
- **三级判定模型**：每项返回 `{ id, level, applicable, ok, evidence, hint }`。`applicable=false` 表示本镜不涉及该项（如无台词则不查口型），不报错也不占用清单——这是「不是全部都必须有」的唯一表达方式，与「涉及但没写」严格分开。
- **23 项检查，分五组**：
  - A 结构完整性：景别、运镜、动作链、无占位套话
  - B 结尾衔接：终点姿态、与下一镜起手一致
  - C 表演与声音：口型、音色一致、音频存在、动作表演、环境声、多人表演不同质
  - D 参考一致性：角色锚点、场景参考、道具参考、参考用途说明、图生/文生模式匹配
  - E 生成风险：标秒合计、固定与移动运镜冲突、多人站位、打戏回合、画面文字风险、高损耗动作、发声引文守真
- **硬项阻断写回**：`error` 级检查不通过时 `submit_prompts` 拒绝写入，并把完整 `checks[]`（含 `evidence` 与 `hint`）作为工具结果返回；Agent 在同一次 tool-call 循环里据此重写再提交，不新增专用修复工具。`warn` 级只提示，不阻断。
- **词表复用既有枚举**：景别取相机库 `mapsToSize`（大特写/远景/全景/中景/特写），运镜取 `mapsToMove`（推/拉/摇/移/升降/跟/手持），不另建一套与项目用词脱节的词表；仅天气、音效、口型、终点语义等需要新增一份小词表。

不做（本变更）：

- 不改 `video_prompt` 是自由文本这一形态，不引入结构化分段模板。
- 不改出片请求拼装、参考图解析、预览一致性与手改快照语义（属 `shot-video-prompt` / `prompt-text-integrity`）。
- 不做模型级语义评审（把正文送 LLM 判「写得好不好」）。首发全部为可解释的文本启发式；`ending-state` / `handoff-consistency` 因误报风险先以 `warn` 起步，收集真实项目后再定是否升 `error`。
- 不修改 `skills/` 下的 `VID-*` 规则编号；应用侧审计以 `checks[].id` 独立命名，规则编号仅作为 `evidence` 引用的解释依据。

## Capabilities

### New Capabilities

- `video-prompt-audit`: 视频提示词内容合规审计——按分镜事实推导适用检查项、给出三级判定与可解释证据、并以硬项阻断 Agent 写回。覆盖检查项定义、豁免判定、阻断契约与结果形状。

### Modified Capabilities

（无）

## Impact

- **审计核**：`src/promptAuditCore.mjs` 扩展 `auditVideoPromptCore`；`src/promptAuditCore.d.mts` 补类型；`src/promptAudit.ts` 增加浏览器侧入参映射（角色卡、参考解析结果）。
- **契约门禁**：`src/skills/contracts.ts` 的 `prompts-v1` 增加跨字段审计钩子——schema 校验通过后仍需审计通过才可写回。
- **Agent 工具**：`submit_prompts` 的失败回执需要携带 `checks[]`；写入路径（`src/agent/*` 与 `src/skills/tools.ts`）确认阻断分支不会静默落库。
- **新词表**：新增一个纯常量模块（天气/音效/口型/终点语义等），其余词表从 `src/cameraLexicon.ts` 与相机库 manifest 派生。
- **界面（可选，P1）**：画布 `Inspector` 视频页可展示本镜审计结果，复用同一审计核；本变更 P0 只保证工具层阻断。
- **测试**：新增审计核纯函数验收（各项 applicable/ok 的正反例）、`prompts-v1` 阻断用例；回归 `verify-script-hub.mjs` 之外的既有提示词相关脚本。
- **文档**：`README.md` 补视频提示词审计口径；技能侧不新增 `VID-*` 编号。
