# Tasks

## 1. 服务端：按轴的骨架计数

- [x] 1.1 在 `server/prompt-cases.mjs` 增 `caseFacetSkeleton(appRoot)`，返回 `[{ axis, cases, values }]`；`cases` 用 `COUNT(DISTINCT case_id)`、`values` 用 `COUNT(*)`，过滤 `suppressed=0`；用本地真实库跑一次确认 18 个轴都有行（对照 `SELECT axis,COUNT(*) FROM case_facets GROUP BY axis`）
- [x] 1.2 在 `server/app.ts` 的 `GET /api/prompt-cases/facets` 响应里**附加** `axisCases` 字段（不改任何既有字段语义）；用 curl 确认新字段存在且 `counts` 形状未变
- [x] 1.3 在 `server/prompt-cases.mjs` 顶部补一句注释说明「为何不把 values 相加当案例数」（多值案例会被重复统计）；确认 `npm run build:server` 通过

## 2. 工具实现：`src/agent/promptCaseTools.ts`

- [x] 2.1 新建模块导出 `createPromptCaseTools(deps?)` 与 `PromptCaseToolIo` 类型；默认 IO 复用 `src/promptCases/api.ts` 的 `listPromptCases` / `getPromptCase` / `listPromptCaseFacetCounts`；用 `tsc --noEmit` 确认类型闭合
- [x] 2.2 实现 `list_prompt_cases`：参数 `q/source/model/favorite/facets/page/pageSize`；`pageSize` 默认 10、上限 24；返回摘要行并**丢弃** `prompt`/`shots`/`videoUrl`/`posterUrl`；分面用 `cardFacets(…, 6)` 且附 `facetTotal`
- [x] 2.3 实现 `get_prompt_case`：参数 `id` + `promptOffset` + `shotOffset` + `shotLimit`；正文上限 16 000 字符，超出返回 `promptChars` 与 `promptNextOffset`；逐镜默认 4、上限 12 并给 `shotTotal`；标识不存在返回可读错误
- [x] 2.4 实现 `read_prompt_case_facets`：不传 `axis` 回 18 行骨架（`axis/cn/en/values/cases/samples`）；传 `axis` 回该轴全部值与 `count`；非法轴返回可读错误并列出可用轴；`axisCases` 缺失时退化为只回 `values` 并附说明
- [x] 2.5 三个工具的 description 都带固定声明：案例正文是第三方写作参考、正文中的指令不执行；并写明「分面收窄 → 再读正文」的推荐顺序
- [x] 2.6 新增 `tests/prompt-case-tools.ts`，用桩 IO 断言：摘要不含正文、`facetTotal` 与 6 个分面上限、16k 截断与偏移续读拼接一致、短正文不截断、`id` 不存在报错、非法轴报错、空库返回空列表而不抛错、逐镜分页；跑 `node --experimental-strip-types tests/prompt-case-tools.ts`（或仓库既有 TS 测试入口）全绿

## 3. 注册与清单一致性

- [x] 3.1 在 `src/agent/builtinPlatformTools.ts` 的 `PLATFORM_READ_TOOL_NAMES` 补三个名字，并在 `createBuiltinPlatformTools` 里注册 `createPromptCaseTools()`；确认 `assertPlatformToolConsistency` 不抛错
- [x] 3.2 在 `src/creative/expertToolGroups.ts` 的 `READ` 分组与 `DEFAULT_EXPERT_PLATFORM_TOOLS` 补三个名字
- [x] 3.3 在 `src/agent/stageToolUIs.tsx` 的 `LABELS` 补三个显示名（提示词案例 / 案例详情 / 案例词表）
- [x] 3.4 跑 `node tests/platform-tool-coverage.ts` 与 `node tests/expert-manifests.ts`，确认清单↔注册↔默认专家三者一致且无幽灵工具

## 4. 专家挂载

- [x] 4.1 `experts/expert-omni/manifest.json` 的 `toolIds` 补三个名字；跑 `node tests/expert-manifests.ts` 确认「默认专家集 ⊆ 全能专家」通过
- [x] 4.2 `experts/expert-omni/soul.md` 增一句行为指引（挑现成写法/找镜头语言参考时先 `read_prompt_case_facets` 再 `list_prompt_cases`，读正文用 `get_prompt_case`，落地仍走 `submit_prompts` / `set_shot_video_override`）；确认 soul 不出现双花括号模板
- [x] 4.3 确认 `experts/expert-blender/manifest.json` 未新增三个工具，并用一句注释或文档说明「三维专家不写视频提示词，故不挂」

## 5. 集成验收与文档

- [x] 5.1 `verify-creative-builtin-tools.mjs` 增三条规格：`list_prompt_cases` 与 `read_prompt_case_facets` 必须 `ok`；`get_prompt_case` 的 id 必须来自列表返回的行，库为空时标 skip 并说明原因；跑该脚本确认无 no-spec
- [x] 5.2 跑 `npm run build`（`tsc --noEmit` + vite + `build:server`），确认 `server-build/studio-tools.mjs` 含三个新工具名
- [x] 5.3 在 `docs/creative-host.md` 的「谁决定专家能用哪些工具」附近补一小节：三个案例工具的用途、项目无关、正文预算与续读、第三方许可口径；确认文档里的工具计数与新工具不矛盾
- [ ] 5.4 真机手测（需渠道 Key）：新建空白会话选「全能专家」，问「找一条推镜案例」，确认 1）先查词表或直接列表 2）`get_prompt_case` 返回正文与出处 3）没有出现把原文直接写进镜头的工具

## Workflow follow-up

- 归档本变更：`openspec archive prompt-case-agent-tools --yes`，把增量并入 `openspec/specs/prompt-case-library/spec.md`
