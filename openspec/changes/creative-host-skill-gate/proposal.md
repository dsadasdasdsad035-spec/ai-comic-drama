# Proposal

## Why

仓库内置技能已经全部是标准 Agent 包（`SKILL.md` + `references/`，`profile: agent-pack`），但创意会话的宿主发现仍按「来源必须为 SkillHub 或上传」过滤。于是内置包在顶栏「偏好技能」下拉里永远不出现；技能包整包落盘那次迁移把 19 条上传记录统一成 `builtin` 之后，这个下拉从 19 项直接变成 0 项——内置技能看起来「读不到」，实际是入口被硬过滤。同时专家模式下列表仍列出全部技能、读取才按白名单拒绝，形成「先推荐、后被拒」的割裂。

## What Changes

- **宿主门不再看来源**：顶栏「偏好技能」下拉与 `list_installed_skills({ hostsOnly: true })` 的筛选条件收敛为「是否为 Agent 包」（`profile === 'agent-pack'`），`builtin` 与 `skillhub` / `upload` 一视同仁。旧工作台形态技能仍被排除，因为它们本来就不会解析成 Agent 包。
- **下拉分组显示**：宿主选项按来源分两组（`内置技能` / `市场安装`），某组为空时不渲染组头；默认选项仍为「自动（技能目录）」，下拉只作为手动覆盖。
- **列表口径与专家白名单对齐**：专家模式下 `list_installed_skills` 只列该专家 `skillIds` 允许的技能，并在回执里带一行说明（另有 N 个技能被该专家限制），避免把会被 `read_skill*` 拒绝的技能推荐给用户。`skillIds` 含 `*` 时行为不变。
- **空目录文案纠正**：现文案「尚未安装 Agent 包… `list_installed_skills` 为空」与实际不符（内置 20 个技能仍可列出）。改为区分「没有可作宿主的 Agent 包」与「技能目录确实为空」两种状态。
- **补齐回归验证**：新增宿主门单测（三种来源都进入宿主列表与 `hostsOnly` 结果）与一条创意页冒烟（无专家时下拉必须包含内置包）。上一轮只验了 `/api/skills`、设置页目录与附件读取，漏掉了创意页下拉这个入口。

## Capabilities

### New Capabilities

无。本次不引入新能力，只修正既有宿主发现与专家白名单的判定口径。

### Modified Capabilities

- `creative-chat`: 「无专家模式可选顶栏偏好 Agent 包」的要求补充「不得按技能来源过滤」与分组展示口径，并规定「自动（技能目录）」为默认值、空目录提示必须区分无宿主与无技能。
- `creative-experts`: 专家白名单要求补充「`list_installed_skills` 的可见集与 `read_skill*` 的可读集一致」，并规定被限制的技能数量必须以可读形式告知；`*` 通配语义不变。

## Impact

- 宿主发现：`src/creative/creativeSkillHost.ts`（`listCreativeHostSkills` 过滤条件）、`src/agent/stageTools.ts`（`list_installed_skills` 的 `hostsOnly` 分支与 schema 描述）。
- 专家约束：`src/creative/expertTools.ts`（把 `list_installed_skills` 纳入白名单包装）、`src/creative/creativeTurnPayload.ts`（专家 system 中的技能白名单说明）。
- 顶栏 UI：`src/creative/CreativeHeader.tsx`（`skillChoices` 改为分组结构、空目录横幅文案）、`src/creative/CreativeStudio.tsx`（传入分组数据）。
- 验收脚本：新增宿主门单测与创意页冒烟；无需改动 `verify-skill-*` 现有断言（它们验的是安装与文件读取，不受本次口径影响）。
- 不涉及数据迁移：技能 `source` 字段语义不变，已有安装记录无需重写。
