# Tasks

## 1. 摘除历史裁剪

- [x] 1.1 删除 `src/agent/pi/threadMemory.ts` 中的 `TOOL_RESULT_MAX`、`KEEP_USER_TURNS`、`MAX_CONTEXT_CHARS` 与 `shrinkJson`、`shrinkOldToolResults`；按 design 决策 2 直接移除 `compactPiThreadMemory`（不保留恒等函数），只读体积说明由 `describePiThreadMemory` 承担。验证：`verify-creative-thread-fidelity.mjs` 构造一份 7 732 字技能结果，经 `uiThreadToPiMessages` 后该 `toolResult` 仍含完整正文且不含 `truncated` 字段
- [x] 1.2 同一脚本断言 24 轮之后早期技能正文仍在，且总量超 48 000 字符时不出现「长期记忆」占位。验证：脚本对 30 轮 fixture 与 60 条长消息 fixture 各断言一次，全部通过
- [x] 1.3 `src/agent/pi/stageRunner.ts` 停用 `transformContext` 装配（创意会话不再改写历史）。验证：运行态日志或调试断点确认 `Agent` 构造参数不含 `transformContext`；`SkillChat` 的 `history` 路径不受影响
- [x] 1.4 `docs/creative-studio.md` 中「历史走 Pi `messages` + `transformContext` 长期记忆」改为新的历史保真描述。验证：文档与 `runStageAgent` 实际装配一致，无残留「压枝」「折叠」表述
- [x] 1.5 对齐 `src/creative/creativeTurnPayload.ts` 的 system 承诺：保留「已读可不再重读」时需与 1.1 的历史保真一致。验证：`verify-creative-payload-inspect.mjs` 新增断言——第二轮 payload 的 system 含该承诺且 `priorPiMessages` 含完整技能正文

## 2. 上下文超限给出可读出路

- [x] 2.1 服务端 `/api/text` 识别上下文长度类上游错误，在 error 事件里带 `kind: 'context-overflow'`（与既有 `thread-too-large` 错误约定同构）。验证：向 mock 渠道注入 400 超限报文，error 事件含该 kind
- [x] 2.2 前端按 `kind` 呈现中文说明与「新建会话」建议，不再裸露渠道报文。验证：注入 2.1 的错误后，界面出现「本次会话上下文已满，建议新建会话」，且侧栏历史仍可打开
- [x] 2.3 非上下文类上游错误保持原有呈现，不被新分支改写。验证：注入普通 500 报文，仍显示渠道 + 状态 + 截断报文

## 3. 线程保存失败必须可见

- [x] 3.1 把 `src/creative/CreativeStudio.tsx` 四处 `void saveCreativeThread(...).catch(() => {})` 改为捕获后提示「本轮未保存」并给出原因。验证：构造超过 1MB 的线程触发保存，界面出现提示且当前消息不被清空
- [x] 3.2 区分 `thread-too-large` 与网络/服务失败两类原因，各自给可执行下一步。验证：分别注入超限与 500 响应，两种文案不同且都提到下一步动作
- [x] 3.3 保存失败后不自动重试（超限重试必然再失败）。验证：注入超限后观察请求只发一次

## 4. 回归与验收

- [x] 4.1 工作台聊天与场景 agent 的折叠行为不变。验证：`src/agent/threads.ts` 与 `src/agent/pi/compact.ts` 在 `git diff --stat` 中无改动；`verify-canvas.mjs`（8 项）、`verify-agent-context-tool.mjs`（5 项）通过；共用的 `agentMessageReducer` 由新增的 `verify-creative-thread-tool-dedup.mjs`（11 项）覆盖，含「流式占位卡仍被 tool_start 接管」这条工作台也依赖的旧行为。`verify-agent-limits.mjs`、`verify-workbench-chat-clear.mjs`、`verify-agent-chat-ui.mjs` 无法执行：顶栏改版后已无 `.topbar-project select`（现为面包屑），`verify-agent-draft.mjs` 已标记废弃——三者均为预存在腐烂，与本变更无关
- [x] 4.2 类型与既有验收套件全绿。验证：`npx tsc --noEmit` 通过；`verify-creative-builtin-tools.mjs` 47 项、`verify-creative-payload-inspect.mjs` 17 项、`verify-creative-all-skills.mjs` 23 项全部通过。过程中修掉三处与本变更无关的陈旧/污染问题：payload 脚本会把 mock 文本模型写进真实 settings（现改为退出时复原）、「内置专家 ≥3」按已收敛为单专家的事实调整、all-skills 的空目录无技能安装（现只读复制本机安装记录）与仅创意工具白名单
- [x] 4.3 端到端手测：真 dev server + 真项目，连续读两个超过 4 000 字的技能后追问内容细节。验证：`verify-creative-thread-e2e-real.mjs`（ark-plan-text-deepseek，真技能 novel-storyboard 7732 字 + character-refs 6943 字）——第 2 轮请求体 29 279 字符，含只有正文 4000 字之后才出现的 `must_phrases`、`front-full`、`锚点没确认`；模型答出 `must_phrases`、锚点未确认会被拒、以及 `front-full`/`detail-hair`/`detail-neck` 等尾部参数，无「已折叠」「请重读」

## Workflow follow-up

- `/opsx-archive` 归档后核对 `openspec/specs/creative-thread-context/spec.md` 的 Purpose 已从 delta 复制，无 `TBD` 占位
