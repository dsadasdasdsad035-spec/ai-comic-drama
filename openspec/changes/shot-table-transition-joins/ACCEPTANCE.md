# 验收：画布镜间接缝

> 宿主变更：`canvas-only-shots-workbench` 下线镜头表后，接缝的展示与编辑面迁到画布顺序边与转场面板；本验收随之改写，`transitionOut` 仍是唯一持久化来源。

## 数据一致性

- [ ] 本集 3 镜时画布出现 2 条接缝边（S01→S02、S02→S03），不新增 shot 实体
- [ ] 转场面板修改 `generated.prompt` / `soundPrompt` 后落库 project.json，重新水合后边与面板显示相同值
- [ ] `submit_joins` 写回后立即落库并水合，画布边与转场面板同步
- [ ] `transition_out.to` 与播放序下一镜不一致时给出「错位」提示

## UI

- [ ] 无 `transition_out` 的接缝边上只显示「硬切」chip
- [ ] 点开硬切后可在面板升级为效果/生成；切回硬切清空 `transition_out`
- [ ] 窄屏（&lt;960px）转场面板不撑破画布布局

## Agent

- [ ] 画布拆镜助手的写工具包含 `submit_joins`，回执含条数与硬切/效果/生成计数
- [ ] `read_transition_recipes` 可按 taxonomy 过滤；`joins-v1` 通过 `node verify-joins.mjs`
- [ ] 写回即落库，没有「待保存草稿」这一步（与画布分镜 Agent 一致）

## 脚本

```bash
node verify-joins.mjs
node verify-tool-contracts.mjs
node verify-transitions.mjs
node verify-workbench-chats.mjs
openspec validate shot-table-transition-joins --strict
```
