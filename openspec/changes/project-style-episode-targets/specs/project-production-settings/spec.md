# Spec Delta

## Purpose

让用户在单一项目入口维护全片画风锁与画幅，供剧本、分镜、提示词、素材生图等能力只读消费，避免工作台各自兜底。

## ADDED Requirements

### Requirement: 项目制作参数可编辑

系统 SHALL 为当前选中项目提供制作参数编辑能力，至少包含画风（`style`）与画幅（`aspect`）。用户保存后 MUST 写入该项目持久数据，MUST NOT 只保存在某一工作台页面的本地 state。

#### Scenario: 保存画风与画幅

- **WHEN** 用户在项目制作参数中修改画风或画幅并保存
- **THEN** 该项目 `style` 与 `aspect` 更新，其他项目不受影响

#### Scenario: 未选项目

- **WHEN** 未选中任何项目
- **THEN** 制作参数编辑不可用或明确提示先选项目，且不产生写入

### Requirement: 画风为全片唯一权威

系统 SHALL 将项目的 `style` 作为全片画风锁的唯一权威来源。剧本、镜头表、提示词、角色/素材生图与相关 Agent 任务 MUST 只读该字段，MUST NOT 在发送模型时用固定字符串替代空画风。

#### Scenario: 项目已设画风

- **WHEN** 项目 `style` 为非空字符串
- **THEN** 分镜 Agent 任务卡中的画风行与该字符串一致

#### Scenario: 项目未设画风

- **WHEN** 项目 `style` 为空或仅空白
- **THEN** 用户在工作台 Agent 发送前看到明确错误，提示前往项目制作参数补全画风；请求 MUST NOT 发出

### Requirement: 画幅随项目

系统 SHALL 使用项目 `aspect` 作为镜头表与分镜相关 Agent 输入的画幅；缺失时 MAY 使用产品级默认画幅（如 16:9），但 MUST NOT 与项目已保存的 `aspect` 冲突。

#### Scenario: 切换项目更新画幅

- **WHEN** 用户从项目 A 切换到项目 B
- **THEN** 镜头表与 Agent 输入使用的画幅为 B 的 `aspect`
