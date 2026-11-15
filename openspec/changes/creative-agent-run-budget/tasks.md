# Tasks

## 1. 运行器去掉默认步数预算

- [x] 1.1 `src/agent/pi/stageRunner.ts`：`maxSteps` 仅在显式传入时参与终止；未传时不再有默认 16 步；显式上限仍保留终止与「工具循环达到 N 步上限」错误，供测试使用。验证：`node tests/stage-agent.ts` 全部通过（含 `maxSteps: 2` 用例）。
- [x] 1.2 在 `tests/stage-agent.ts` 新增「默认无步数上限」：mock 连续 20 轮工具调用后返回文本，断言 `result.error` 为空、`steps >= 20`、收到最终文本。验证：`node tests/stage-agent.ts` 通过。
- [x] 1.3 `timeoutMessage` 补充「已完成部分保留，可回复继续」；同步更新 `tests/stage-agent.ts` 的超时断言。验证：`node tests/stage-agent.ts` 通过，且错误文案包含「继续」。

## 2. 创意会话接入设置总时长

- [x] 2.1 `src/creative/CreativeStudio.tsx` 发送时调用 `resolveAgentLimits(settings)`，把 `totalMs` 传给 `runStageAgent`；`settings` 缺失时回落到默认 300 秒。验证：`npx tsc --noEmit` 通过，且源码中 `runStageAgent` 调用包含 `totalMs`。
- [x] 2.2 `src/agent/agentLimits.ts` 的注释与适用范围由「3D agent」改为所有聊天；不改变字段、默认值与范围。验证：`node verify-agent-limits-api.mjs` 通过，设置 round-trip 行为不变。
- [x] 2.3 检查设置页「Agent 运行上限」说明，若仍暗示只作用于 3D 则改为所有聊天。验证：`node verify-agent-limits.mjs` 通过，设置页回显与保存一致。

## 3. 文档与回归

- [x] 3.1 更新 `docs/scene-agent-engine.md` 的「上限与取消」：默认无工具轮次预算；总时长来自设置；显式安全阀只用于测试/诊断。验证：全文搜索无「工作台 16」。
- [x] 3.2 运行 `npx tsc --noEmit`、`node tests/stage-agent.ts`、`node tests/pi-stream.ts`、`node verify-agent-limits-api.mjs`、`node verify-creative-context-overflow.mjs`，确认运行时、设置与创意错误呈现无回归。
- [x] 3.3 运行 `npm run build`，确认 TypeScript、Vite 与 server bundle 均通过。

## Workflow follow-up

- 归档前同步 `chat-agent-runtime` 规格，确认 `openspec validate creative-agent-run-budget` 通过。
- 归档后检查 `docs/scene-agent-engine.md` 与设置页不再出现「步数上限」的产品表述。
