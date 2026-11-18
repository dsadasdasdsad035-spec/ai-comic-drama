# Tasks

## 1. 宿主谓词与列表口径

- [x] 1.1 在 `src/creative/creativeSkillHost.ts` 新增 `isCreativeHostSkill(s)`（仅判 `isAgentPackSkill`），让 `listCreativeHostSkills` 改用它；验证：新增 `tests/creative-host-skills.ts` 构造 `builtin` / `skillhub` / `upload` / 工作台形态四类样本，断言前三类进入候选、后一类被排除，`node verify-skills-unit.mjs` 通过
- [x] 1.2 把 `src/agent/stageTools.ts` 的 `hostsOnly` 分支改为调用同一谓词，并同步该参数的 schema 描述（去掉「SkillHub/上传」限定）；验证：`tests/creative-host-skills.ts` 断言 `hostsOnly` 返回三种来源的技能、且与 `listCreativeHostSkills` 结果集完全一致
- [x] 1.3 删除 `src/creative/creativeTurnPayload.ts` 中位于 `isAgentPackSkill(host)` 之后、对可达宿主不可执行的 `isMarketInstalledSkill` 分支，并确认该函数没有其它调用点后一并移除；验证：`rg isMarketInstalledSkill src` 无残留引用，`tsc --noEmit` 通过

## 2. 顶栏宿主下拉分组与空态

- [x] 2.1 把 `src/creative/CreativeHeader.tsx` 的 `skillChoices` 改为 `hostGroups: Array<{ label, options }>`，用 `<optgroup>` 渲染并跳过空组，「自动（技能目录）」保持为组外首项；验证：`verify-creative-host-gate.mjs` 断言下拉含「内置技能」组头、且不存在空的「市场安装」组
- [x] 2.2 调整 `src/creative/CreativeStudio.tsx` 的数据通路：同时保留全部技能数（`skillCount`）与宿主候选集，并按来源生成 `hostGroups` 传给头部；验证：同一冒烟脚本断言真实环境下组内条目数等于内置 Agent 包数（当前为 20）
- [x] 2.3 抽出纯函数 `creativeHostBanner(skillCount, hostCount)` 决定横幅文案，替换现有「尚未安装 Agent 包…list_installed_skills 为空」；验证：`tests/creative-host-skills.ts` 覆盖 `(0,0)`、`(N>0,0)`、`(N>0,M>0)` 三种输入，分别得到「目录为空」「有 N 个技能但没有可作宿主的 Agent 包」「无横幅」

## 3. 专家模式列表口径

- [x] 3.1 在 `src/creative/expertTools.ts` 新增 `wrapSkillListForExpert`，按 `skillIds` 过滤 `list_installed_skills` 返回项，`*` 时直接放行，并在专家工具装配处挂上；验证：`tests/creative-host-skills.ts` 用 `skillIds: ['a','b']` 与 `['*']` 两种专家各断言一次过滤结果
- [x] 3.2 过滤回执追加一行「另有 N 个技能被专家「<name>」限制」，让模型可转述限制；验证：同文件断言受限专家回执含该说明、通配专家回执不含
- [x] 3.3 确认专家模式与无专家模式互不影响：`stageTools` 未新增专家参数，无专家路径结果集不变；验证：`tests/creative-host-skills.ts` 断言不传专家时返回全部技能

## 4. 集成验收

- [x] 4.1 新增 `verify-creative-host-gate.mjs`（沿用 `verify-skill-settings.mjs` 的 spawn + playwright-core 结构），在无专家状态下断言宿主下拉含内置包、切到「全能专家1」后下拉隐藏；验证：`node verify-creative-host-gate.mjs` 退出码 0 且无 ❌
- [x] 4.2 跑完整单元测试入口，确认本次新增测试与既有技能/创意测试同时通过；验证：`node verify-skills-unit.mjs` 全绿
- [x] 4.3 跑类型检查与生产构建，确认无死引用与打包回归；验证：`npm run build` 成功

## Workflow follow-up

- 归档前跑一次 `openspec validate creative-host-skill-gate --strict`。
- 归档用 `/opsx-archive`，不要手工移动 change 目录。
- 专家白名单内容（是否把 `byted-sol-seedance-prompt` 加进「全能专家1」）不在本次范围，如需调整另开变更。
