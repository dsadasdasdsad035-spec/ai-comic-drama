# Proposal

## Why

创意（DSH）会话里 `read_characters` 恒返回 `characters: []`，即使界面角色板里已有角色。原因是创意读适配器把 `artifact` 标成 `characters`，而其 `ownDraft()` 恒为 `undefined`，于是 `charactersData()` 走「只读活草稿」分支，永不回退到项目快照。模型因此认为项目没有角色，进而重复创建角色或拒绝引用已有角色，角色一致性链路在这条路径上失效。

## What Changes

- 修正创意读适配器的角色读取：`read_characters` 必须读当前项目快照的 `project.characters`，与 `read_designs`、`read_shots` 同源。
- 保留 `read_characters` 的既有参数（`names` 过滤）与返回形状（`characters` / `total` / `truncated` / `note`），不改变过滤与截断语义。
- 收紧「活草稿」分支：`ownDraft()` 不是数组时不再直接当成空集合，避免同类静默空结果。
- 增加覆盖创意平台工具路径的回归测试：项目有角色时 `read_characters` 必须非空；项目确实无角色时才返回空数组。
- 不改变技能工作台（`shot-read` 等）已有的 adapter 语义与测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `creative-asset-tools`: 新增「创意会话的细粒度读工具读项目快照」要求，明确 `read_characters`、`read_designs` 在创意路径下必须返回当前项目数据，空结果只表示项目确实没有该数据；既有过滤与返回形状保持不变。

## Impact

- `src/agent/builtinPlatformTools.ts`：`createReadAdapter` 的 `artifact` 与 `ownDraft` 语义。
- `src/agent/stageTools.ts`：`charactersData`（以及同构的 `designsData`）的草稿/快照选择逻辑。
- `tests/`：创意平台工具路径的读工具回归断言。
- 不改动 DSH 宿主、工具桥协议、专家 preset 与前端界面。
