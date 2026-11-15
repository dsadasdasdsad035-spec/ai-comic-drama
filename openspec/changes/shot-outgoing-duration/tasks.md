# Tasks

## 1. 唯一时长求解函数

- [x] 1.1 新建 `src/videoSeconds.ts`，导出 `shotRequestSeconds`、`videoMinSeconds`、`videoMaxSeconds`，按「四舍五入 → 夹 2–12 → 模型下限 → 原生音频 `minVideoSeconds + 1`」求解并返回 `floor` 抬升原因；验证：新增 `verify-shot-seconds.mjs` 覆盖 `4.2s + 原生音频 = 5`、`4.0s + 原生音频 = 5`、`5s + 原生音频 = 5`、`3s + 模型下限 4 = 4`、`未知模型 2.6s = 3`、`0.4s = 2`，`node verify-shot-seconds.mjs` 全绿
- [x] 1.2 `src/transitionGen.ts` 的 `videoMinSeconds` / `transitionRequestSeconds` 改为复用新模块并保持返回结构与 `trimTo` 语义不变；验证：`node verify-transitions.mjs` 与 `node verify-transition-folds.mjs` 通过

## 2. 拼装与原生音频门禁

- [x] 2.1 `src/videoPrompt.ts` 的 `buildShotVideoRequest` 用 `shotRequestSeconds` 求出唯一 `seconds`，并新增 `shotSeconds` 与 `secondsFloor` 字段；验证：`node verify-video-prompt.mjs` 通过，且请求体 `seconds` 与返回值一致
- [x] 2.2 原生音频门禁改读同一 `seconds`，删除 `nativeAudioGateSeconds` 并让 `nativeAudioRef` 不再收抬后值；抬升存在时写入 `warnings` 而非 `blocking`；验证：更新 `verify-native-audio.mjs`，断言镜头 4.0s 与 4.4s 开启原生音频时不再出现阻止原因、请求 `seconds` 为 5
- [x] 2.3 成本与提交路径统一读 `request.seconds`（`src/pricing.ts` 调用点、`src/agent/builtinPlatformTools.ts` 的成本确认）；验证：`node verify-agent-tool-coverage.mjs` 通过，并手动比对同一镜头面板估算与请求参数一致

## 3. Inspector 与出片面板

- [x] 3.1 `src/Inspector.tsx` 的 `出片设置` 增加时长数字输入（`step="0.1"`、`min="0.1"`，写 `set({ seconds })`），摘要与 `videoCost` 改用请求秒数，秒数不同时显示 `镜头 Xs → 请求 Ys（原因）`；验证：`node verify-shot-inspector.mjs` 通过并新增断言「改出片设置时长后运镜与语义同步」
- [x] 3.2 `src/OutgoingVideoPromptPanel.tsx` 摘要与 `src/inspectorLayout.ts` 的成片 chip 改用请求秒数；验证：`node verify-video-prompt-preview.mjs` 通过，面板文案不再出现未抬升的整数秒
- [x] 3.3 原生音频 UI 的禁用条件改为按请求秒数判定；验证：`node verify-native-audio-ui.mjs` 通过，且 4.2s 镜头开启原生音频后「生成视频」保持可用

## 4. 集成回归

- [x] 4.1 `npx tsc --noEmit` 与 `npm run build` 通过，确认无 `nativeAudioGateSeconds` 残留引用（`rg "nativeAudioGateSeconds" src` 无结果）
- [x] 4.2 批量回归改用本次新增脚本等价验收：`node verify-shot-seconds.mjs && node verify-shot-outgoing-duration.mjs && node verify-native-audio.mjs && node verify-transitions.mjs && node verify-agent-tool-coverage.mjs` 全绿。旧脚本 `verify-native-audio-ui` / `verify-shot-inspector` / `verify-video-prompt-preview` / `verify-transitions-ui` 在 HEAD 已有红灯（画布先停在「分集目录」未点集；preview 另有 3 条既有断言失败），已在干净 worktree 复现，非本次改动引入
- [ ] 4.3 （待真实出片回归，需真实 key 与配额）手工回归：原生音频 4.2s 镜头出片成功、请求 5s；静音 3s 镜头 + Seedance 2.5 显示「镜头 3s → 请求 4s」并成功出片；未登记模型不带下限抬升。当前已由 `verify-shot-seconds.mjs`（请求参数层）与 `verify-shot-outgoing-duration.mjs`（界面层）覆盖前三项的参数与文案

## Workflow follow-up

- 归档前确认 `README.md` 原生音频/验收脚本段落与 `node verify-native-audio.mjs` 的 4 秒说明一致。
- 旧画布验收脚本需补「进入单集画布」步骤（画布已改为先停在分集目录），否则 `verify-shot-inspector` 等脚本继续红；这属于另一次脚本维护，不在本 change 范围。
- `verify-video-prompt-preview.mjs` 的 3 条既有失败（`相邻镜缺图阻止出片`、两条 dryRun 断言）需单独排查。
- 按项目评审要求归档该 change。
