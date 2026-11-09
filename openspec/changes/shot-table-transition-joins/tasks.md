# Tasks

## 1. 数据与契约

- [x] 1.1 定义 `joins-v1` Zod schema（`contracts.ts`）与 `submit_joins` 工具声明；`node` 脚本校验样例 payload
- [x] 1.2 实现 `applyJoinsToShots(joins, shots)` 纯函数：写 `transitionOut`、校验 `after_no`/`to_no`、返回错误列表；`verify-joins.mjs` 覆盖
- [x] 1.3 扩展 `transitionRecipes.json` 字段（`taxonomy`、`modeHint`、`seedanceHints`）；文档更新 `transitionRecipes.README.md`；目标 ≥40 条（可分批提交）

## 2. 镜头表接缝 UI

- [x] 2.1 `ShotTable` 渲染播放序接缝行（硬切折叠 / 展开表单）；不新增 shot 实体
- [x] 2.2 接缝编辑调用与画布共用的 `normalizeTransitionOut` + `onPatch` 写 `transition_out`；插删镜后接缝行数量正确
- [x] 2.3 非相邻 `transitionOut` 不匹配下一镜时显示警告态；提供「打开画布转场面板」入口
- [x] 2.4 样式 `theme.css`；窄屏折叠行为

## 3. transition-planner Agent

- [x] 3.1 新增 `skills/transition-planner/SKILL.md`（六类 taxonomy、Seedance 提示词结构、recipe 引用规则）
- [x] 3.2 `ShotTable` workbenchChat：第二内置动作「规划本集镜间转场」；`writeTool: submit_joins`、`writeContract: joins-v1`
- [x] 3.3 `read_transition_recipes` 工具（或静态读 json 片段）；设置页可选环节模型
- [x] 3.4 回执文案：写入条数、硬切/效果/生成计数、未保存提示

## 4. 与现有转场能力对齐

- [x] 4.1 确认接缝 `prompt`/`soundPrompt` 进入 `autoTransitionVideoPrompt` 链路（已有则补 UI 说明）；更新 README 分镜转场章节
- [ ] 4.2 可选：恢复转场面板「应用规则建议」入口，读同一 `transitionRecipes`
- [x] 4.3 扩展 `verify-transitions.mjs` 或 `verify-joins.mjs`：taxonomy + 食谱 id 解析

## 5. 验收

- [x] 5.1 编写 `ACCEPTANCE.md`（表接缝 ↔ 画布 ↔ project.json 一致；Agent 草稿保存；硬切折叠）
- [x] 5.2 `openspec validate shot-table-transition-joins --strict` 通过
- [ ] 5.3 Archive 后合并 delta 至 `openspec/specs/shot-table-transition-seams/spec.md` 与 `shot-transition-agent/spec.md`
