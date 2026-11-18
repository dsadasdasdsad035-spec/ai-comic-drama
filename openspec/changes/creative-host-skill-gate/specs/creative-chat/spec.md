# Spec Delta

## MODIFIED Requirements

### Requirement: 创意会话专家与自动技能目录双模式

创意工作室 SHALL 支持两种互斥的 Pi 约束模式：（1）**无专家**：默认自主发现技能，可选用顶栏「偏好」Agent 包，并可使用 `list_installed_skills`；（2）**有专家**：按 `creative-experts` 能力约束 system、技能与工具。用户 MUST 可通过顶栏专家下拉切回「无（技能目录）」恢复（1）。无专家模式下的偏好候选集 MUST 为全部 Agent 包技能，MUST NOT 按安装来源（内置 / 市场 / 上传）过滤。

#### Scenario: 无专家等同原自动模式

- **WHEN** 专家下拉为「无」
- **THEN** 使用 `buildCreativePiSystem` 与偏好技能逻辑，与未引入专家前行为一致

#### Scenario: 有专家覆盖自主壳

- **WHEN** 用户选择内置或自定义专家
- **THEN** 创意对话 MUST NOT 使用 `buildCreativePiSystemAutonomous` 拼接段落作为 system

#### Scenario: 仓库内置 Agent 包可作宿主

- **WHEN** 某技能的来源为仓库内置（`skills/<id>/`）且其形态为 Agent 包
- **THEN** 该技能出现在顶栏偏好下拉与 `list_installed_skills({ hostsOnly: true })` 结果中，可被选为宿主并被 `read_skill_text` 读取

#### Scenario: 旧工作台形态技能不进入宿主候选

- **WHEN** 某技能缺少 Agent 包 frontmatter 或带有工作台 manifest 特征（`stage` / `tools` / `## 任务` 等）
- **THEN** 该技能不出现在偏好下拉与 `hostsOnly` 结果中，即使其文件存在于技能目录

## ADDED Requirements

### Requirement: 创意宿主下拉分组与空态

顶栏偏好技能下拉 SHALL 默认停在「自动（技能目录）」，仅作为手动覆盖入口。候选项 MUST 按来源分组展示（内置技能 / 市场安装）；某组无候选时 MUST NOT 渲染该组标题。技能目录非空但没有任何可作宿主的 Agent 包时，界面 MUST 说明「没有可作宿主的 Agent 包」，MUST NOT 声称技能目录为空或 `list_installed_skills` 为空。

#### Scenario: 默认自动

- **WHEN** 用户未手动指定偏好技能
- **THEN** 下拉显示「自动（技能目录）」，本轮 system 走自动目录发现分支而非偏好分支

#### Scenario: 分组展示

- **WHEN** 已安装技能同时包含内置 Agent 包与市场安装 Agent 包
- **THEN** 下拉出现「内置技能」「市场安装」两个分组，各自只含对应来源的技能

#### Scenario: 空分组不渲染

- **WHEN** 市场安装来源没有任何 Agent 包
- **THEN** 下拉只渲染「内置技能」分组标题，不出现空的「市场安装」组

#### Scenario: 有技能但无宿主

- **WHEN** `/api/skills` 返回非空技能列表，但没有任何技能是 Agent 包
- **THEN** 头部提示「没有可作宿主的 Agent 包」，且不提示用户去市场安装重复技能包
