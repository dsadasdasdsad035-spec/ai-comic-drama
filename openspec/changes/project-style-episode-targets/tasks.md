# Tasks

## 1. 数据模型与解析

- [x] 1.1 在 `ProjectEpisode` 增加可选 `targetSeconds`；新增 `src/productionContext.ts`（`resolveProjectStyle`、`requireProjectStyle`、`resolveEpisodeTarget`、`DEFAULT_EPISODE_TARGET_SECONDS`）并加单测覆盖空画风、缺字段默认 60、分集覆盖
- [x] 1.2 更新 `mergeScriptDraft`：incoming 无 `targetSeconds` 时保留 current；单测覆盖改稿不丢时长

## 2. 项目制作参数 UI

- [x] 2.1 在项目管理入口（`ProjectManagerDialog` 或等价）增加画风、画幅编辑并 `patchProject`；验证切换项目后字段正确加载
- [x] 2.2 新建/加载项目时各工作台不再维护独立 `style` 写入口（剧本页移除画风编辑或改为跳转/只读展示）；验证画风仅项目管理可写

## 3. 分集目标时长 UI

- [x] 3.1 `ScriptBoard`：移除顶栏全剧「每集目标时长」；分集卡片增加 `targetSeconds` 编辑，保存时写入 `episodes`；验证保存后 JSON 含各集字段
- [x] 3.2 `ShotTable`：顶栏目标时长绑定当前集 `targetSeconds`；保存时一并 `patchProject` 的 `episodes`（与 shots 合并或顺序提交）；验证剧本页与镜头表显示一致

## 4. Agent 与技能

- [x] 4.1 各工作台 `chatAdapter.inputs()` 改用 `productionContext`；删除所有 `近未来科幻写实` fallback；`SkillChat` 发送前 `requireProjectStyle`；验证 Inspector 任务卡画风/时长与项目/当前集一致
- [x] 4.2 更新 `skills/script/SKILL.md`（每集 `targetSeconds` 输出）、`skills/shotlist/SKILL.md`（system 与 target 以任务为准）；更新 `tests/skill-prompts.ts` golden；`node tests/skill-prompts.ts` 通过
- [x] 4.3 调整 `intakeSkill.ts` 与 script 内置拆集参数（无顶栏全剧时长后仍合理传参）；相关 verify 脚本改用 fixture `style`

## 5. 回归

- [x] 5.1 运行 `openspec validate project-style-episode-targets --strict` 与 `node verify-workbench-chats.mjs`（及受影响的 verify-workbench-*）；退出码 0
- [x] 5.2 更新 `README.md` 中工作台/项目参数说明：画风在项目设置、时长按集维护

## Workflow follow-up

- 审阅通过后运行 archive 流程同步主 spec。
