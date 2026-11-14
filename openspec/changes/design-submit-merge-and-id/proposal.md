# Proposal

## Why

聊天写回 `submit_designs` 复用了人工编辑的同一 POST 通道，服务端把 `designs` 当作"整体替换"处理。但 `designs-v1` 契约里没有标识字段，每张卡落库时 `design_id` 都是空串，撞上 `UNIQUE(project_id, design_id)` ——同一个项目最多只能存一张空标识的卡。于是第二次提交在 `DELETE` 已经提交之后失败：已有卡的图片、候选图和手工改过的英文锚点全部丢失，未参与本次提交的卡被删除，而写入错误被 `void patchProject(...).then(...)` 吞掉，模型收到的是 `ok:true`。

同一批空标识的卡对 agent 完全不可见：`read_asset_inventory` 要求每行有非空 key，`design_id=''` 的行被静默丢弃，`scenes` 报 0。模型据此判定"项目里没有场景"，重新拆一遍再提交，把上一轮的卡再抹一次——一个自我强化的回路。

## What Changes

- `submit_designs`（创意台与内置平台工具两条入口）改为按"类型 + 规范化名称"合并，不再整表替换
- 设定卡获得稳定、非空的标识：新建时生成，历史空标识的值回填
- 合并时保留已有卡的当前图、候选图、选中项、手工锚点与关联镜号（关联镜号取并集，只补空字段）
- 未参与本次提交的设定卡 MUST 保留
- `designs` 写入包进事务；失败回滚，不留下"删了但没插进去"的中间态
- 写回失败必须回到调用方：`applyProjectDraft` 不得在 HTTP 落库前返回成功
- **BREAKING**：`designs-v1` 的语义从"替换"变为"合并"。仓库内调用方均走 `patchProject` 直传整表，不受影响；但依赖该契约删除设定卡的外部用法需改为显式删除

## Capabilities

### New Capabilities

无。本次不引入新能力，只修正既有能力的行为。

### Modified Capabilities

- `scene-prop-design`: "重复拆解合并且保护手改"的适用范围从人工拆解扩展到聊天写回路径；新增"设定卡标识稳定且非空"与"设定写回原子、失败可见"两条要求

## Impact

- `src/platform/projectDraft.ts` — `designs-v1` 分支改为合并；失败路径补 `.catch` 并回传错误
- `src/designExtract.ts` — `mergeDesigns` 从无人调用的死代码变为唯一合并入口；补契约字段的 snake_case → camelCase 映射
- `src/skills/contracts.ts` — `designItem` 是否承载标识
- `src/server/db.mjs` — designs 写入事务化；历史空 `design_id` 回填
- `tests/` — 按 `scene-prop-design` 的四条 Scenario 补断言

## Out of Scope

- `assets` 表里 `url` 为空的人手占位行仍会被 `read_asset_inventory` 静默丢弃（`assets` 计数为 0）。那是读侧准入规则，且没有替代读工具，单独处理
- `projectCache` 模块级单例导致的冻结快照
- 多写入方并发的乐观锁或版本令牌
