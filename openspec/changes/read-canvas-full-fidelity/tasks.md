# Tasks

## 1. 按条装填基础设施

- [x] 1.1 新增 `src/agent/readBudget.ts` 导出 `packRecords(items, budget)`，返回 `{ items, total, returned, truncated, oversized }`；新增 `tests/read-budget.ts` 断言三条规则：只装整条、超限标 `truncated` 并给总数、单条超预算时整条返回并标 `oversized`
- [x] 1.2 把 `tests/read-budget.ts` 加入 `verify-skills-unit.mjs` 的 `TESTS` 列表，`node verify-skills-unit.mjs` 通过

## 2. 既有读工具改为整条装填

- [x] 2.1 改 `read_shots`：列表改用 `packRecords`（预算 24,000）、新增可选 `cursor` 并返回 `nextCursor`、`shotIds` 路径返回完整记录且超出条数上限时列出未返回的 id；在 `tests/shot-read.ts` 断言续读覆盖全集不重不漏、游标失效时报错、20 个 shotIds 全量返回
- [x] 2.2 改 `read_episodes` 与 `read_episode`：镜头摘要改用 `packRecords` 并标明 `truncated`/`total`；`tests/shot-read.ts` 断言超限时响应为合法 JSON 且不含残缺镜头条目
- [x] 2.3 改 `read_characters`、`read_designs`、`read_transition_recipes` 与 `read_asset_detail` 的记录返回：不再对 JSON 做字符串切片，超限时整条保留并标记；`tests/shot-read.ts` 断言过滤语义不变、超限响应可 `JSON.parse`
- [x] 2.4 收窄 `boundJson` 用途：仓库内对数组的调用点为 0（`rg "boundJson\\("` 逐个确认），并确认白模代码仍走 `includeCode` 的显式字符串截断与字符数报告

## 3. 单镜钻取与出片正文

- [x] 3.1 新增 `read_shot_detail`：按 `no`/`shotId` 接受定位、返回该镜完整记录（含视频提示词各形态、`transition_out`、`refIds`、`refExtras`、`handEdited`），镜号不存在时返回可用范围；`tests/shot-read.ts` 断言有手改与模板渲染正文的镜头两者都在响应里
- [x] 3.2 新增 `read_shot_video_prompt`：复用 `effectiveVideoPrompt` 与 `buildShotVideoRequest` 的优先级返回 `{ text, source, stale }`；仅能脚本拼装时返回 `text: null`、`source: 'script_assembled'`、`requiresCanvas: true`；`tests/shot-read.ts` 断言四态（override / video_prompt / keyframe_prompt / script_assembled）各命中一次
- [x] 3.3 把两个新工具注册进 `createStageToolSet` 的 `readByName` 与 `byName`，`tests/shot-read.ts` 断言工具名可查且只读（无 `submit_` 副作用）

## 4. 工具清单、专家白名单与文档

- [x] 4.1 同步三处清单：`builtinPlatformToolNames()`、`src/skills/tools.ts` 的 `KNOWN_TOOL_IDS`、`src/creative/expertToolGroups.ts` 的 `READ` 与 `DEFAULT_EXPERT_PLATFORM_TOOLS`；`tests/shot-read.ts` 断言两个新工具都出现在清单与默认专家工具集里
- [x] 4.2 `verify-creative-builtin-tools.mjs` 增加新工具的实际调用与续读断言（同一集连续两次读到不同镜头、`nextCursor` 最终消失），`node verify-creative-builtin-tools.mjs` 通过
- [x] 4.3 在 `README.md` 的 Agent 工具说明处补一段：分镜读取按整条装填、超限用游标续读、单镜与出片正文用钻取工具；按文档写法执行一遍命令确认可复现

## 5. 集成验证

- [x] 5.1 用本地真实项目（第 1 集 31 镜）跑一次续读全流程，确认覆盖全部镜头且每条 `video_prompt` 都出现在某次响应里
- [x] 5.2 `npx tsc --noEmit` 无错误，`node verify-skills-unit.mjs` 全绿，串行读工具相关 verify 脚本无回归

## Workflow follow-up

- 归档该变更，把 `shot-read-tools` 与 `creative-asset-tools` 的 delta 合并进主规格。
- 归档后确认 `openspec/specs/creative-asset-tools/spec.md` 不再含「不得改变 `read_shots` 截断策略」的旧约束。
