# 验收：镜头表镜间接缝

## 数据一致性

- [ ] 本集 3 镜时表中出现 2 条接缝行（S01→S02、S02→S03），不新增 shot 实体
- [ ] 接缝行修改 `generated.prompt` / `soundPrompt` 后保存 project.json，画布转场面板显示相同值
- [ ] 画布修改转场字段后重新加载镜头表，对应接缝行同步
- [ ] `transition_out.to` 与播放序下一镜不一致时接缝行显示「错位」警告

## UI

- [ ] 无 `transition_out` 的接缝默认折叠为「硬切」摘要
- [ ] 展开硬切后可升级为效果/生成；切回硬切清空 `transition_out`
- [ ] 窄屏（&lt;960px）接缝表单不撑破表格横向滚动

## Agent

- [ ] 镜头表聊天内置「规划本集镜间转场」切换到 `transition-planner`，`submit_joins` 回执含条数与硬切/效果/生成计数
- [ ] `read_transition_recipes` 可按 taxonomy 过滤；`joins-v1` 通过 `node verify-joins.mjs`
- [ ] 草稿未点「保存到 project.json」前不落库（与镜头表其他 Agent 一致）

## 脚本

```bash
node verify-joins.mjs
node verify-tool-contracts.mjs
node verify-transitions.mjs
openspec validate shot-table-transition-joins --strict
```
