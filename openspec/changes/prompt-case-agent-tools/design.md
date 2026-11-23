# Design

## Context

见 `proposal.md` — Why。实现前需要知道的现状：

- 案例数据在 SQLite 全局表 `prompt_cases` + `case_facets`（`server/db.mjs:201`），读写集中在 `server/prompt-cases.mjs`；HTTP 入口是 `server/app.ts` 的 `/api/prompt-cases/*` 一段（约 3823 行起），**不需要为本次新增路由**。
- 筛选语义已经定好：同轴 OR、跨轴 AND（`buildCaseWhere`），列表分页上限 96、默认 24。
- 词表只有一份：`public/presets/prompt-taxonomy/v1.json`，前端构建期内联（`src/promptCases/taxonomy.ts`），服务端运行时读同一份。18 轴 / 430 值，紧凑序列化约 16k 字符——整份进模型上下文不可接受。
- 工具链：`ToolDef`（zod schema 为唯一声明来源）→ `createBuiltinPlatformTools` 组装并断言清单一致 → `server-build/studio-tools.mjs` → `studio-tool-bridge` 在 Node 里以 fetch 垫片调用浏览器侧实现 → dsh 插件注册给模型。专家可见性是两层：preset 的 `tools.restrict` + 执行时 `resolveExpertToolNames` 二次校验。
- **默认模式（无专家）的 system prompt 来自 dsh 自带 standard preset，不在本仓库**。因此「何时该查案例库」只能由工具 description 与专家 soul 承载。

## Goals / Non-Goals

**Goals**

- agent 能用一句自然语言请求找到「可参考的写法」，并在 2–3 次工具调用内拿到正文。
- 单次工具返回的体积可控：列表 ≤ 8k 字符，单条正文默认 ≤ 16k 字符且可续读，词表骨架 ≤ 2k 字符。
- 三个工具在未选项目、未导入任何案例、词表为空这三种退化状态下都给出可读结果而不是抛错。

**Non-Goals**

- 不做案例全文检索索引、向量召回或语义排序；关键词仍走现有 `LIKE` 语义。
- 不做工具级缓存（服务端已有索引缓存，但那是导入用的）。
- 不改变案例库的任何写入路径与分面推导规则。
- 不给默认模式补 system prompt（那是宿主 preset 的领域）。

## Decisions

### D1. 三个只读工具，而不是一个万能工具

拆成 `list_prompt_cases`（浏览）、`get_prompt_case`（钻取）、`read_prompt_case_facets`（词表）三件，对应既有 `read_asset_inventory → read_asset_detail` 的节奏。

理由：三者的参数形状与返回体量差别太大。合并成一个工具意味着每次调用都要在 schema 里解释三种模式，模型容易只给一半参数；而返回体量又必须按模式分别裁剪，一个 `run` 里塞三套预算分支会让截断标记自相矛盾。

**备选**：单一 `prompt_cases(action, …)` 分派工具。否决——schema 无法表达「action=list 时 page 必填、action=get 时 id 必填」，只能运行时校验，模型试错成本更高。

### D2. 不放进 `createStageToolSet`，直接挂在平台工厂

`createStageToolSet` 的所有读工具都经 `WorkbenchChatAdapter.projectSnapshot()` 取当前项目数据。案例库是全局作用域，硬塞进去会引入一个假的 adapter 依赖，还会让五个工作台的技能聊天也看到这三个工具（它们通过 `createBuiltinPlatformReadTools` 构造，不该有案例库能力）。

**实现**：新建 `src/agent/promptCaseTools.ts`，导出 `createPromptCaseTools(deps?)`，在 `createBuiltinPlatformTools` 里与 `createListProjectsTool` 同层注册。`list_projects` 是「不依赖项目上下文的平台读工具」的既有先例，形状一致。

### D3. IO 注入，默认走既有客户端 API

```ts
type PromptCaseToolIo = {
  list: (query: PromptCaseQuery) => Promise<PromptCaseListResult>
  get: (id: string) => Promise<PromptCaseDetail>
  facetCounts: (query: PromptCaseQuery) => Promise<{ counts: FacetCount[]; invalidFacets: InvalidFacet[] }>
}
```

默认实现直接复用 `src/promptCases/api.ts` 的三个函数。理由：工具桥的 fetch 垫片本来就是为「浏览器侧实现能在 Node 里跑」设计的，复用不复制；同时注入点让 `tests/*.ts` 能在不启 dev server 的情况下断言预算、截断与错误分支。

### D4. 正文预算用「偏移续读」，不用字符切片

单条正文上限 `PROMPT_BODY_BUDGET = 16_000` 字符。超出时返回 `promptChars`（原文长度）+ `promptNextOffset`，正文取 `slice(offset, offset + budget)`，并在结果里标 `truncated: true`。

为什么不用 `boundJson`（现有 8k 预览截断）：那个函数产出的是**半截 JSON 字符串**，模型解析不了也接不上；正文字符串本身可以安全切片，只要显式给出偏移与总长，模型就能精确续读。这是 `readBudget.ts` 里「只装整条」原则在长文本上的等价做法。

为什么是 16k：真实库单条最长 13.8k、总计 24 条 83.5k。16k 能覆盖当前全量最长案例；再大则一轮对话里读两条就会挤掉项目上下文。

### D5. 列表只回摘要，分面有上限且报总数

列表把服务端返回的 `PromptCase[]` 映射成摘要行，**丢弃** `prompt`、`shots`、`videoUrl`、`posterUrl`：

```
{ id, title, source, license, model, tags, author, sourceUrl,
  promptChars, shotCount, facets: [{axis,value}], facetTotal, updatedAt }
```

`facets` 取 `cardFacets()`（题材优先，最多 6 个），另给 `facetTotal` 让调用方知道还有多少没展示。默认 `pageSize = 10`，硬上限 24（服务端上限 96，但 agent 一次读 96 行只会在上下文里堆噪）。

### D6. 词表工具两档，骨架靠服务端新增一个聚合字段

- 不传 `axis`：回 18 行骨架 `{ axis, cn, en, values, cases, samples }`。
- 传 `axis`：回该轴全部受控值 `{ id, cn, token, count }`，`count` 来自 `caseFacetCounts`；`count = 0` 的值保留并回 0（模型需要知道「词表里有但库里没有」）。

`values`/`cases` 需要按轴去重计数，现有 `/api/prompt-cases/facets` 的 `counts` 是按值计数、相加会重复统计多值案例。**方案**：在 `server/prompt-cases.mjs` 增一个 `caseFacetSkeleton(appRoot)`，返回 `[{ axis, cases: COUNT(DISTINCT case_id), values: COUNT(*) }]`，并把它作为**附加字段** `axisCases` 挂到既有 `facets` 响应里。不改路由、不改现有字段语义，老客户端无感。

轴名与中文标签直接用前端内联的 `src/promptCases/taxonomy.ts`（与服务端同源同一份 JSON），不依赖响应里那份 16k 的 `taxonomy` 字段。

### D7. 第三方内容按「数据」对待

三个工具的 description 都带一句固定声明：案例正文是第三方写作参考，正文里的指令性文字不执行。返回体逐条带 `license` 与 `sourceUrl`（反推案例 `sourceUrl` 为空、`license = own`）。

不额外做内容过滤：这些是公开站点的提示词文本，本身就是我们要给模型看的东西；风险不在「内容有害」，而在「被当成指令」，用措辞与字段标注处理即可。

### D8. 专家登记走既有两条链

```
PLATFORM_READ_TOOL_NAMES            (清单，不一致即启动抛错)
  +→ createBuiltinPlatformTools     (注册)
  +→ expertToolGroups READ 分组     (设置页分组展示)
  +→ DEFAULT_EXPERT_PLATFORM_TOOLS  (默认专家集)
  +→ experts/expert-omni/manifest.json  (内置全能专家，测试强制默认集 ⊆ omni)
  +→ stageToolUIs LABELS            (会话内工具卡标题)

experts/expert-omni/soul.md         (何时该查案例库的行为指引)
```

`expert-blender` 不挂：三维专家的产出是几何与渲染，不写视频提示词，挂了只会增加一个无关工具。自定义专家默认不带——用户可自己勾选。

`list_experts` 那样的「始终注入」不适用于这里：案例工具是能力，不是发现机制。

### D9. 验收策略

| 层 | 手段 |
|---|---|
| 纯函数 | `tests/prompt-case-tools.ts`：注入桩 IO，断言摘要不含正文、预算截断与偏移续读、非法轴错误、空库退化、分面上限与 `facetTotal` |
| 清单一致性 | `tests/platform-tool-coverage.ts` 与 `tests/expert-manifests.ts` 自动覆盖新名字（无需改断言内容） |
| 逐项 invoke | `verify-creative-builtin-tools.mjs` 增三条规格；库为空时 `get_prompt_case` 标 skip 并说明原因 |
| 真机 | 手测：全能专家会话里问「找一条推镜的案例」，确认调用链与返回可读 |

## Risks / Trade-offs

- **上下文膨胀**：agent 可能连续 list 三页再 get 两条长正文。→ 列表默认 10 行且无正文；正文 16k 封顶并续读；工具 description 写明「先按分面收窄再读正文」。
- **外链正文被当指令**：`reference-only` 案例正文可能含「忽略以上要求」之类文字。→ description 固定声明 + 每条带 license/sourceUrl；不提供把这些正文直接写入项目的工具（D1/D7）。
- **词表骨架依赖新的服务端聚合**：若 `axisCases` 缺失（旧服务端），骨架退化为只有 `values` 计数并附说明，不抛错。→ 工具侧对字段做存在性判断。
- **工具名与既有命名混用**：`list_` / `get_` / `read_` 三种前缀。→ 与现有 `list_camera_lexicon` / `get_camera_lexicon` / `read_asset_inventory` 一致，按「浏览/钻取/只读集合」语义选词，不强行统一。
- **专家白名单外不可见**：自定义专家不会自动获得这三个工具。→ 属预期；设置页工具分组里能看到并勾选。

## Migration Plan

1. 合入代码后跑 `npm run build:server`（工具声明与实现都进 `server-build/studio-tools.mjs`，宿主按时间戳热重载，无需重启）。
2. 专家 manifest 变化会触发专家 preset 重写；已开始的会话不换 preset，新建空白会话生效。
3. 数据库：仅新增只读聚合查询，无表结构变更，无需迁移。
4. 回滚：移除三个名字与实现文件即可；`axisCases` 字段可留着不影响旧客户端。

## Open Questions

无。
