# Design

## Context

镜头写回只有 `POST /api/project` 一个入口，`server/app.ts` 收到 `body.shots` 就调 `mergeShots(cur.shots, body.shots)`，而 `mergeShots` 把「不在本次列表里」的既有镜头一律保留并标 `orphan`。前端有 10 个写回点，形态分两类：整表（`applyProjectDraft` 的 `shots-v1`、画布增删插改号、`delete_shots`、打开时 reconcile、出片改稿）与局部（画布防抖、参考清理、`writeShotBack` 单镜、分镜表导入）。局部写回因此持续生产 `orphan`。

`orphan` 目前没有消费者：画布 `shotToData` 恒定写 `orphan: false`，Inspector 的「孤儿」徽标是死代码，清理入口随镜头表退役；只有 `read_shots` 原样回传，模型会把它当事实转述给用户。宿主侧另有一处断链：`applyProjectDraft` 提交成功后会调 `ctx.onProjectDataChanged?.()`，但 `CreativeStudio` 创建平台工具时从未传该回调，于是画布只在重启/切项目后更新。

动机见 `proposal.md`，行为契约见 `specs/`。

## Goals / Non-Goals

**Goals:**

- 让「提交子集」不再产生任何副作用标记，且缺省行为就是安全的
- 保留「整表写回缺席 = 保护性保留」这一诊断能力，但必须由调用方显式声明
- 清掉存量的 14 个（乃至更多）`orphan` 标记，使 Agent 读回不再看到假象
- Agent 写回成功后画布与时间线立即可见，不依赖重启

**Non-Goals:**

- 不恢复孤儿标记的可见性、也不恢复「清理孤儿」入口（真实孤儿只是整表写回的错误信号，修好后不该常态存在）
- 不改 `deleteShotIds` 语义、不改字段级合并与 `handEdited` 只增不减
- 不改并发写回的 last-write-wins 模型（已知限制，见 Risks）
- 不动 `server/data.mjs`（legacy JSON store，已无引用）

## Decisions

### D1 用 `shotsMode` 字段，而不是新端点

`POST /api/project` 增加可选 `shotsMode: 'partial' | 'full'`，透传给 `mergeShots`。

- 替代一：新增 `POST /api/project/shots/patch` 专供局部写回。REST 更干净，但要复制一遍鉴权、项目名校验、`pruneDanglingTransitions`、重复镜号校验，两条路径将来还会漂移。
- 替代二：客户端局部写回时先 GET 全集、合并后 PUT 全集。多一次往返，且 GET→PUT 之间的并发写会被整表覆盖，比现在更危险。
- 选字段的理由：一个语义开关就能覆盖全部 10 个调用点，且服务端只有一处分支。

### D2 缺省 `partial`

请求不带 `shotsMode` 时按局部处理。理由是比较两种「忘了传」的爆炸半径：

- 默认 `full`：将来任何新的局部写回点漏传，就重新开始生产不可见、不可清理的 `orphan`（就是这次要修的病）。
- 默认 `partial`：将来任何整表写回点漏传，只是少打一个诊断标记，镜头不会被删、也不会丢字段。

删除本来就只能靠 `deleteShotIds` 显式点名，所以 `full` 的「保护」价值仅在诊断，值得为此让缺省更安全。

### D3 `mergeShots` 保持返回全量列表

签名改为 `mergeShots(existing, incoming, mode = 'partial')`，返回仍是「本次提交的镜（按提交顺序）+ 其余既有镜」。这样 `server/app.ts` 后续的 `findDuplicateShotNos` 与 `pruneDanglingTransitions` 依旧看到完整集合，不必分叉。`mode === 'partial'` 时跳过打标记的那一步即可。

### D4 历史标记用一次性迁移，不是每次读取时过滤

迁移在 `open()` 之后、由持久标记把关：`settings` 写 `shots.orphanCleanedAt`，未设置时执行

```sql
UPDATE shots SET extra = json_remove(extra, '$.orphan')
WHERE json_extract(extra, '$.orphan') = 1
```

- 替代一：`readProject` 里过滤（像 `shotToData` 那样丢掉）。会把 `full` 写回新产生的合法标记一起吞掉，等于隐瞒问题。
- 替代二：加 `orphan` 固定列。为一次性数据演进改表结构，成本不划算。

### D5 刷新复用 `onProjectDataChanged`，不新增通道

`applyProjectDraft` 已经在每个契约写成功后调用 `ctx.onProjectDataChanged?.()`（`src/platform/projectDraft.ts`），链路缺的只是最外一段：

```
App.tsx  materialHost  →  CreativeStudio  →  createBuiltinPlatformTools({ onProjectDataChanged })
        →  projectDraft 提交后回调  →  App.refreshProjectSnapshot()  →  hydrateCanvasShots()
```

`App.refreshProjectSnapshot` 已存在（读项目 → `setProjectShots` → `hydrateCanvasShots`），只需作为新 prop 传下去。替代方案是让 `CreativeStudio` 自己 `getProject` + 水合，但那样要求它知道画布布局与 `syncedRef` 的语义，会把宿主职责塞进对话组件。

### D6 导入走默认 `partial`，不改 `planShotImport`

`planShotImport` 返回的就是「文件覆盖到的镜头」，让它保持原样、不声明 `mode`，即自动获得局部语义：导入第 1 集不再把第 2 集标脏。删除仍由同一次请求的 `deleteShotIds` 显式表达。

### D7 客户端 API 改成选项对象

```ts
mergeProjectShots(name, shots, opts?: { deleteShotIds?: string[]; mode?: 'partial' | 'full' })
```

现在第三个参数是 `deleteShotIds?: string[]`，再加位置参数会变成 `mergeProjectShots(name, shots, undefined, 'full')` 这种读不懂的调用。10 个调用点一起改，机械且可 grep 校验。

## Risks / Trade-offs

- [整表写回点漏标 `full`，保护语义静默失效] → 加一条结构测试：断言 `applyProjectDraft`、`persistProjectShots`、`delete_shots`、reconcile、出片改稿这 5 处都显式传 `'full'`；并在 `mergeProjectShots` 的 `mode` 类型上不给可选默认（调用方必须自己决定是不是要传）。
- [增量与整表写回并发交错] → 两者都是字段级合并、last-write-wins，既有风险不变；`partial` 不引入新覆盖面，只是不再顺带打标记。
- [刷新回调打断用户操作] → 只在写工具成功返回后触发一次；`hydrateCanvasShots` 按 `shotId` 复用节点与位置，不会重置视口（除非显式 `fit`）。刷新不传 `fit`。
- [迁移把 `full` 写回新产生的标记也清掉] → 迁移由 `settings` 标记把关，只执行一次，且放在这批新逻辑上线前完成。
- [旧客户端连新服务端：所有写回都变 `partial`] → 回到「不再产生孤儿」，方向正确；`orphan` 对旧客户端本来也不可见。

## Migration Plan

1. 服务端：`mergeShots` 加 mode、`POST /api/project` 读 `shotsMode`、`open()` 之后执行一次性清理并写 `settings` 标记。
2. 客户端：`mergeProjectShots` 改选项对象；5 处整表写回点声明 `full`；其余不动。
3. 客户端：`CreativeStudio` 透传 `onProjectDataChanged`，`App` 传 `refreshProjectSnapshot`。
4. 验证：单镜写回后其余镜无 `orphan`；整表缺镜仍标 `orphan`；导入单集不动其他集；迁移幂等；`submit_shots` 后画布无需重启即更新。

回滚：去掉 `shotsMode` 支持即回到旧行为；被清理的 `orphan` 是派生标记，回滚不涉及数据恢复。
