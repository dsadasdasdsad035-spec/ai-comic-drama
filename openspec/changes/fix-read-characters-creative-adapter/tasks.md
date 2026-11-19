# Tasks

## 1. 读工具回退到项目快照

- [x] 1.1 在 `src/agent/stageTools.ts` 抽出去重逻辑：`ownDraft()` 是数组就直接用（含空数组），不是数组才调用 `projectSnapshot()` 取对应集合；`charactersData`、`designsData`、`shotsData` 共用。验证：`npx tsc --noEmit` 通过
- [x] 1.2 收紧 `read_characters`/`read_designs` 的空结果语义：未选项目时由快照加载返回可读错误，不再成功返回 `[]`。验证：本地调用未选项目的 `read_characters` 得到 `ok: false` 与可读提示

## 2. 回归测试

- [x] 2.1 在 `tests/` 增加创意构造路径断言：`createBuiltinPlatformTools({ projectName, getSnapshot: () => 含 2 个角色的项目 })` 调 `read_characters` 返回 2 条。验证：`npm test` 对应脚本通过
- [x] 2.2 断言项目 `characters: []` 时仍返回 `ok: true` 与 `total: 0`，且 `names` 过滤与超限截断语义未变。验证：同测试文件全绿
- [x] 2.3 断言 `read_designs` 在同一条创意路径仍返回项目设定卡，防止后续改动把 `designsData` 改回只读草稿。验证：同测试文件全绿

## 3. 文档

- [x] 3.1 在 `docs/creative-host.md` 的读工具说明处补一句：创意会话的细粒度读工具读当前项目快照，`ownDraft` 缺失不等于空数据。验证：文档中可直接检索到该说明

## Workflow follow-up

- 归档前确认 `read_characters` 在真机创意会话里返回角色，再执行 `openspec archive`。