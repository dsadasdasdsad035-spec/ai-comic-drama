# Design

## Context

创意会话的「宿主」概念指：无专家模式下顶栏可手动指定的默认 Agent 包。宿主候选集现在由 `listCreativeHostSkills` 产出，判定条件是 `isMarketInstalledSkill(s) && isAgentPackSkill(s)`，其中 `isMarketInstalledSkill` 只认 `skillhub` / `upload`。`list_installed_skills` 的 `hostsOnly` 分支复制了同一条件，形成两处独立判定。

同一份条件还出现在 `buildCreativePiSystem` 的分支判断里，但它排在 `isAgentPackSkill(host)` 之后，因此对 Agent 包宿主不可达。

现状事实（本次调查实测）：`/api/skills` 返回 20 个技能，全部解析为 `agent-pack`，全部来源为 `builtin`。宿主候选集因此为 0。技能正文与 `references/` 读取链路本身正常。

## Goals / Non-Goals

**Goals:**

- 让「是否为宿主」只由一个谓词定义，宿主下拉与 `hostsOnly` 共用它，杜绝两处漂移。
- 让专家模式下的技能列表与可读集一致，把拒绝前移到列表阶段。
- 空态文案能区分「没有技能」与「有技能但没有宿主」。

**Non-Goals:**

- 不改技能安装、落盘、附件读取的任何逻辑（`skill-packages` 能力不动）。
- 不改专家 `skillIds` 的具体内容，即不替用户决定「全能专家1 该不该会 Seedance」。
- 不加下拉搜索、折叠、收藏等交互；本次只到分组与默认值。
- 不重写 `source` 字段语义，不做数据迁移。

## Decisions

### 1. 宿主判定用「形态」而非「来源」

新增单一谓词：

```ts
export function isCreativeHostSkill(s: Skill): boolean {
  return isAgentPackSkill(s)
}
```

理由：Agent 包形态（`profile === 'agent-pack'`）是能力契约，`source` 只是安装渠道。把渠道写进判定，每多一个渠道（内置、市场、未来的本地导入）就会再失效一次；本次故障正是这一点的直接后果。

备选方案：把来源白名单扩成 `['builtin', 'skillhub', 'upload']`。否决——它把同一个错误再固化一次，且下次加渠道时同样会漏。

`isMarketInstalledSkill` 保留导出但不再参与宿主判定；它在 `buildCreativePiSystem` 里的分支位于 `isAgentPackSkill` 之后，对任何可达宿主都不可执行，属于死分支，本次一并删除以免误导后来者。

### 2. 分组在前端做，接口保持扁平

`/api/skills` 与 `list_installed_skills` 仍返回扁平列表。分组是展示口径，按 `source` 在前端归并即可，没有必要让 Pi 的列表回执多一层结构——模型需要的是 id 清单，不是 UI 分组。

`CreativeHeader` 的入参从 `skillChoices: Array<{ id, label }>` 改为 `hostGroups: Array<{ label: string; options: Array<{ id, label }> }>`；渲染时跳过 `options.length === 0` 的组。默认项「自动（技能目录）」仍单独占一项且不在任何组内。

### 3. 专家可见性用包装器，不改 `stageTools` 核心

`stageTools.ts` 保持专家无关。在 `src/creative/expertTools.ts` 现有的 `wrapSkillReadForExpert` 旁边新增同类包装 `wrapSkillListForExpert`，把 `list_installed_skills` 的返回项按 `skillIds` 过滤，并在回执追加一行限制说明。这样「专家约束」仍集中在一个文件，`stageTools` 不需要知道专家存在。

备选方案：给 `list_installed_skills` 加 `expertId` 参数。否决——等于把专家概念泄进通用工具层，编辑/分镜等其它工作台会继承一个它不需要的参数。

`skillIds` 含 `*` 时包装器直接放行（与 `read_skill*` 的现有语义一致）。

### 4. 空态判定用「总数 vs 宿主数」

`CreativeStudio` 已同时持有 `skillCatalog`（宿主集）与 `totalSkillsCount`（= 宿主集长度）。为避免再加一个请求，把技能总数改为 `skillCatalog.length` 之外的第三个值：`skillCount`（`parseSkillRecords` 的全部技能数）。头部据此分流：

```text
skillCount === 0            -> 「技能目录为空，可到技能市场安装」
skillCount > 0 && hosts === 0 -> 「有 N 个技能，但没有可作宿主的 Agent 包」
hosts > 0                   -> 不显示横幅
```

这需要 `CreativeStudio` 在 reload 时同时记录总数，属于一次小的数据通路调整。

## Risks / Trade-offs

- **[宿主下拉变长 20 项]** → 默认停在「自动」，下拉只作覆盖；分组把 20 项收进一个组标题下，视觉噪音可接受。后续若要更强，可加按族二级前缀，但不在本次范围。
- **[迁移后市场组恒为空，分组短期无收益]** → 明确记录为已知事实，不把「分组没效果」误判为缺陷。分组的价值在下次从市场装机后体现。
- **[专家可见集收窄，模型可能改用其它工具试探]** → 回执必须给出「另有 N 个技能被该专家限制」的可读句子，让模型能把限制转述给用户，而不是反复重试。
- **[删除 `isMarketInstalledSkill` 分支影响范围被低估]** → 该分支对可达宿主不可执行，但删除前需确认没有其它调用点；若发现仍有调用，则保留函数、仅改宿主判定，并把死分支标注为遗留。
- **[测试盲区重现]** → 本次故障根因是「只验了 API 与设置页，没验创意页入口」。因此验收必须包含一条真实页面断言（无专家时下拉含内置包），不能只做纯函数单测。

## Migration Plan

无数据迁移。代码合并后：

1. 客户端重新 `loadSkills()`，宿主候选集从 0 变为 20（全在「内置技能」组）。
2. 已存的本机偏好技能 id 若不在新候选集内，`resolveCreativeHostId` 已经会回落到「自动」，无需额外处理。
3. 回滚只需还原四处代码，无持久化状态需要清理。

## Open Questions

无。专家白名单的具体内容属于产品决策，已明确排除在本次范围外；若要调整，另开变更。
