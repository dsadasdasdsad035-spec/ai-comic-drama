# Tasks

## 1. 词表与审计核骨架

- [x] 1.1 从 `src/cameraLexicon.ts` 的 catalog 派生 `SIZE_TERMS` / `MOVE_TERMS`（取 `mapsToSize` / `mapsToMove` 去重，并补「中近景」「中全景」等包含式别名）；验证：`node -e` 打印两组词表，景别 5 类、运镜 7 类全部在内。
- [x] 1.2 新增小词表常量（`WEATHER_TERMS` / `SFX_TERMS` / `LIP_TERMS` / `ENDING_TERMS` / `FIGHT_TERMS` / `TEXT_RISK_TERMS` / `RISKY_ACTION_TERMS` / `PLACEHOLDER_TERMS`），单文件集中维护；验证：每组非空且无重复项。
- [x] 1.3 在 `src/promptAuditCore.mjs` 新增 `auditVideoPromptCore(shot, ctx)`，返回 `{ checks, blockers, warnings }`，实现 A 组 4 项（`size-declared` / `move-declared` / `action-chain` / `placeholder-free`）；验证：纯函数测试对每组正反例断言 `applicable` 与 `ok`。
- [x] 1.4 补 `src/promptAuditCore.d.mts` 的 `AuditCheck` / `VideoPromptAudit` 类型与 `auditVideoPromptCore` 签名；验证：`npx tsc --noEmit` 通过。

## 2. 表演、声音与参考一致性检查

- [x] 2.1 实现 C 组 6 项（`lip-sync` / `voice-consistent` / `audio-ready` / `performance-action` / `ambient-sound` / `perf-diversity`）；验证：无台词时 `lip-sync` 的 `applicable` 为 false 且不进入 `blockers`，有台词无口型时为 true 且报 error。
- [x] 2.2 实现 D 组 5 项（`cast-anchor` / `scene-ref` / `prop-ref` / `ref-described` / `mode-matched`）；验证：`cast` 为空时 `cast-anchor` 不适用；参考集为空且正文自足时 `mode-matched` 通过。
- [x] 2.3 `cast-anchor` 复用首帧审计的 `lookEn` 匹配逻辑，不复制一份；验证：同一镜头首帧与视频审计返回相同的缺失角色集合。
- [x] 2.4 实现 B 组 2 项（`ending-state` / `handoff-consistency`），首发 `level: 'warn'`，末镜时 `handoff-consistency` 的 `applicable` 为 false；验证：末镜只返回终点姿态检查；本镜终点与下镜起手矛盾时 `evidence` 同时列出两侧原文。

## 3. 生成风险检查

- [x] 3.1 实现 `duration-fit` 与 `camera-conflict`：解析正文标秒分段，合计与 `seconds` 比对，并检测同一时段固定与移动运镜共存；验证：分段合计等于镜长时通过，不等时 warn 并列出两侧数值。
- [x] 3.2 实现 `multi-person-blocking` / `fight-rounds` / `text-risk` / `physically-risky`；验证：`cast` 少于两人时 `multi-person-blocking` 不适用；打戏词未命中时 `fight-rounds` 不适用。
- [x] 3.3 实现 `dialogue-fidelity`：提取正文引号与标签内的发声引文，与剧本、视觉设定、分镜定稿比对，不在定稿内报 error；验证：编造台词命中 error，原文引述通过。
- [x] 3.4 汇总 23 项为一个 `CHECKS` 注册表，每项声明 `id`、`level`、适用判定与执行函数，新增项只改注册表；验证：注册表条目数为 23，且 `checks` 返回顺序稳定。

## 4. 契约接入与阻断

- [x] 4.1 `src/skills/contracts.ts` 的 `prompts-v1` 增加可选审计上下文，schema 通过后逐镜审计；任一 `blockers` 非空则整体失败并返回 `checks[]`；验证：`video_prompt: "画面"` 被拒绝，合规正文通过。
- [x] 4.2 失败回执按 design 决策 6 的形状返回 `ok: false` / `error: video_prompt_audit_failed` / `checks[]`；验证：回执中每项含 `id`、`level`、`applicable`、`ok`、`evidence`、`hint`。
- [x] 4.3 仅 `warn` 时允许写入并随回执返回告警；验证：只有 `ending-state` 告警的正文写回成功，且项目内提示词已更新。
- [x] 4.4 确认阻断分支不产生副作用：被拒绝的写回不得部分更新镜头；验证：拒绝后读取该镜 `video_prompt` 与提交前一致。
- [x] 4.5 确认 Agent 在同一次 tool-call 循环里能依据回执重写并成功提交；验证：自动化用例先提交不合规正文、再按 `hint` 提交合规正文，两次结果符合预期。

## 5. 消费点与文档

- [x] 5.1 `src/promptAudit.ts` 增加浏览器侧入参映射（角色卡、参考集摘要、场次 beats），供画布面板复用；验证：同一镜在工具与浏览器映射下返回一致的 `checks` id 与 `applicable`。
- [x] 5.2 画布 Inspector 视频页只读展示审计结果（按 `id` 分组、不适用项折叠）；验证：存在 error 时显示为阻断态，全部通过时显示通过态。
- [x] 5.3 更新 `README.md`：视频提示词审计的 23 项分组、三级判定语义、硬项阻断与 Agent 重写流程；验证：README 描述与实现返回的 `checks[].id` 一致。
- [x] 5.4 新增纯函数验收脚本并接入现有测试约定；验证：`node` 跑通全部 23 项正反例，退出码 0。
- [x] 5.5 回归既有提示词相关脚本（`verify-chat-markdown.mjs`、分镜/提示词相关 `verify-*prompt*`）；验证：全部退出码 0，无因新增审计导致的误拒。

## Workflow follow-up

- 用真实项目样本跑一轮，统计 `ending-state` / `handoff-consistency` 的误报率，再决定是否从 `warn` 升为 `error`。
- 按漏报情况补充天气、音效、口型词表覆盖率。
- 审查通过后执行 `openspec archive video-prompt-audit`。
