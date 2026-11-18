# Spec Delta

## ADDED Requirements

### Requirement: 专家模式技能目录可见性与白名单一致

专家模式下 `list_installed_skills` 的可见集 SHALL 等于该专家 `skillIds` 的可读集：`skillIds` 为具体 id 列表时只列这些技能，含 `*` 时列全部已安装技能。回执 MUST 以可读形式告知被该专家限制的技能数量，使「有技能但不可用」是可解释状态，MUST NOT 让模型先推荐随后被 `read_skill*` 拒绝。无专家模式下列表行为 MUST 保持不变。

#### Scenario: 受限专家只列白名单

- **WHEN** 专家 `skillIds` 为具体 id 列表，模型调用 `list_installed_skills`
- **THEN** 返回项只含 `skillIds` 内的技能，且回执说明另有若干技能被该专家限制

#### Scenario: 通配专家列出全部

- **WHEN** 专家 `skillIds` 为 `["*"]`，模型调用 `list_installed_skills`
- **THEN** 返回全部已安装技能，回执不含限制说明

#### Scenario: 无专家不受影响

- **WHEN** 顶栏专家为「无（技能目录）」
- **THEN** 列表返回全部已安装技能，与本次变更前一致
