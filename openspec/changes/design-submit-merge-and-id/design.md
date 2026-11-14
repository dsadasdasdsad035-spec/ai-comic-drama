# Design

## Context

写回入口有两条，都收敛到 `applyProjectDraft`（`src/platform/projectDraft.ts:26`）：内置平台工具的 `submit_designs`（`src/agent/builtinPlatformTools.ts:77`）与创意工作台的素材 adapter（`src/creative/projectStageAdapter.ts:73`）。两者最终都调 `patchProject` → 服务端 POST `/api/project` → `writeProject`（`src/server/db.mjs:1481`）。

`designs` 的落库在 `writeProject` 里是"先删后插"（`src/server/db.mjs:1540`）：`DELETE ... WHERE project_id` 单独提交，随后逐条 `INSERT`。表上有 `UNIQUE(project_id, design_id)`，而契约 `designItem`（`src/skills/contracts.ts:74`）不含标识字段，`String(d?.id || '')`（`src/server/db.mjs:1550`）把每张卡都写成空串——同一个项目最多只能插成功一张。

`db.mjs` 全文没有 `BEGIN` / `transaction` / `savepoint`，逐条语句自动提交。

`mergeDesigns`（`src/designExtract.ts:79`）已实现按"类型 + 规范化名称"合并、旧值优先、图片与候选保留，但全仓没有任何调用点。

其余四个契约的写回路径都做合并与标识兜底：`shots-v1` 用 `mergeShotsDraft` 并在缺 id 时用 `blankShot(ep, no)` 补（`src/platform/projectDraft.ts:39`），`characters-v1` 用 `mergeCharacters`，`prompts-v1` 用 `mergePromptDraft`，`joins-v1` 用 `applyJoinsToShots`。只有 `designs-v1` 是整表替换。

## Goals / Non-Goals

**Goals:**

- `designs-v1` 的写回语义与另外四个契约对齐：合并而非替换
- 每张设定卡在落库后必然有项目内唯一的非空标识，且改名不改变标识
- 历史空标识的数据在升级后无需用户操作即可恢复可见
- 写回失败时，调用方拿到失败而不是成功摘要

**Non-Goals:**

- 不改 `assets` 表的读侧准入规则（空 `url` 的占位行仍不被 `read_asset_inventory` 列出）
- 不改 `projectCache` 的冻结行为
- 不引入并发写入的版本令牌或乐观锁；本次只保证单次写入内部原子
- 不改人工编辑路径（`AssetBoard` 直传整表的 `patchProject` 调用保持替换语义）

## Decisions

### D1. 合并在客户端 `applyProjectDraft` 完成，服务端只负责原子写入

理由：合并需要区分"本次提交的卡"与"项目里已有的卡"，而"已有"只在客户端快照里有语义；服务端拿到的是一份完整列表，无从判断哪些是被删除、哪些是未被提及。人工删除卡片依赖替换语义，也必须保留。

替代方案：服务端按 `kind + name` 合并。否决——服务端无法区分"人工删掉一张卡"和"这次没提到这张卡"，会把删除也变成保留。

### D2. 标识由写入层兜底生成，不由名称派生

格式沿用 `AssetBoard.addDesign` 已有的形状：`design-<kind>-<毫秒时间戳>-<随机后缀>`（`src/AssetBoard.tsx:214` 用的是 `design-manual-<ts>-<rand>`）。

理由：名称派生（如 `design-scene-雨夜空地`）看似幂等，但改名就会换标识，而 `assets.design_id` 引用着它，会直接断链；同名不同类的卡还会挤在同一个键上。

替代方案：让 `designs-v1` 契约新增必填 `id`，由模型回传。否决为唯一机制——模型漏传或幻觉的概率不可控，且 `passthrough` 已经允许 `id` 透传，回传只是优化路径不是保障。

`designItem` 不新增字段：`passthrough` 下模型若带 `id` 会原样进入 `String(d.id)`，走"沿用"分支；不带则兜底生成。

### D3. 字段映射放在合并之前，`mergeDesigns` 保持 camelCase 签名

契约用 `summary_cn` / `prompt_en`，`DesignSheet` 用 `summaryCn` / `promptEn`（`src/api.ts:751`）。在 `projectDraft` 里加一层 `designContractToSheet()`，合并前转换。

替代方案：让 `mergeDesigns` 同时接受两种命名。否决——它还被 UI 侧以 camelCase 调用，双命名会让"哪个字段优先"变成隐式规则。

### D4. 历史空标识在 `open()` 时补一次，而不是只在写入时补

理由：只在写入时补，用户不触发写回就永远读不到自己已有的卡（`read_asset_inventory` 会一直报 `scenes: 0`）。启动补一次能让升级后立刻正确。

实现位置：`open()` 里 `ensureColumns()` 之后（`src/server/db.mjs:408` 附近），只更新 `design_id = ''` 的行，幂等且不触碰已有标识。

替代方案：一次性 schema 版本迁移。否决——`SCHEMA_VERSION` 目前只用来记录 JSON 迁移结果，没有迁移执行器；为此引入一套版本机机制不划算，而"只补空值"本身幂等。

### D5. `writeProject` 的 designs 写入包进事务

`BEGIN IMMEDIATE` 包住 `DELETE` + 全部 `INSERT`，异常时 `ROLLBACK` 后重新抛出，让 HTTP 层返回 400。

理由：现在 `DELETE` 先提交，插入失败就留下"旧卡全没、新卡没进"的中间态。事务是唯一能把"原子"落地的位置。

替代方案：改成逐条 `INSERT OR REPLACE` 的 upsert，不删。否决——无法表达删除，且标识兜底仍会在冲突时炸。

### D6. `applyProjectDraft` 改为异步

规格要求"写回失败时 MUST 向调用方返回失败，MUST NOT 在落库完成前报告成功"。当前它在 HTTP 出发前就 `return { ok: true }`（`src/platform/projectDraft.ts:119`）。唯一能同时满足两条的实现是等 `patchProject` 完成。

波及面：

| 位置 | 现状 | 改动 |
|---|---|---|
| `src/platform/projectDraft.ts:26` | 同步返回 `DraftApplyResult` | 返回 `Promise<DraftApplyResult>` |
| `src/agent/builtinPlatformTools.ts:99` | 同步调用 | `await` |
| `src/agent/stageTools.ts:586` | 同步调用 | `await` |
| `WorkbenchChatAdapter.applyDraft` | 同步签名 | 允许返回 Promise，调用处 `await` |
| `src/creative/projectStageAdapter.ts:73` | 同步适配 | 返回 Promise |

替代方案：保持同步，失败写入一个错误队列由 `onProjectDataChanged` 带出。否决——模型在队列被消费前已经收到 `ok:true` 并按此继续推理，等于把错误挪到另一条通道。

## Risks / Trade-offs

- [启动回填改写用户数据] → 只更新 `design_id = ''` 的行，不改其它列；语句幂等；补的是原本就存在但不可见的卡，不新增行
- [异步化波及 `WorkbenchChatAdapter` 接口，回归面大] → 该接口的 `applyDraft` 目前只有两个实现，逐一改；先补测试覆盖"失败返回"路径，再改签名
- [`submit_designs` 语义从替换变合并，模型若依赖清空行为会失效] → 在工具描述里写明"合并、不删除未提及的卡"，并补一条 Scenario 级测试
- [唯一约束仍在，两张同类同名手工卡会被合并成一张] → 与"按类型和规范化名称合并"的既有规格一致，不是新行为；`manual-row-editing` 规格已经要求同名时提示用户改名
- [事务在单连接上持有写锁] → `writeProject` 是同步调用，事务窗口内无法插入其它请求；窗口只有几十毫秒，可接受
- [兜底标识不稳定：同一张卡若在两次写入前都被判为空，会生成两个标识] → 启动回填先把历史值补齐，写入路径只会遇到"本次新建"的卡，且新卡在列表里已带标识

## Migration Plan

1. 发布后首次启动：`open()` 补 `design_id = ''` 的行，只改该列
2. 无需用户操作；回滚旧版本不会报错——旧代码按空串读，只是回到"看不到这些卡"的旧行为，数据本身无损
3. 不涉及 schema 变更，无 `ALTER TABLE`
