# Spec Delta: dsh-tool-bridge

## MODIFIED Requirements

### Requirement: 工具声明与校验共用同一份定义

宿主工具 SHALL 由同一份参数定义生成模型可见声明与执行前校验，MUST NOT 维护第二份手写声明。声明参数为对象、带默认值的可选字段 MUST NOT 被标为必填。模型提交的参数不符合定义时 MUST 在执行前被拒绝，并向模型返回可读校验错误。**`generate_clip` 的工具描述 MUST 写明正文优先级**：存在有效 `video_prompt_override` 时逐字使用 override；否则若调用提供 `prompt` 则使用本次 `prompt`；否则使用镜上 `video_prompt`（及既有回退链）。描述 MUST NOT 暗示可选 `prompt` 会被忽略。

#### Scenario: 改一处即同步

- **WHEN** 某工具的参数定义新增一个可选字段
- **THEN** 模型可见声明随之变化，无需修改第二处

#### Scenario: 非法参数

- **WHEN** 模型提交的参数缺少必填字段
- **THEN** 工具不执行，模型收到指明缺失字段的可读错误

#### Scenario: generate_clip 描述与行为一致

- **WHEN** 模型在无 override 的镜上调用 `generate_clip` 并传入 `prompt`
- **THEN** 实际提交的 `prompt` 等于参数中的 `prompt`，与工具描述一致

## ADDED Requirements

### Requirement: 镜级出片写工具纳入平台内置清单

系统 SHALL 把 `set_shot_video_options`、`set_shot_video_override`、`set_shot_ref_extras`、`set_shot_neighbor_refs` 注册为平台内置工具，列入专家设置可选名单与默认全能专家白名单；这些工具 MUST NOT 要求成本确认，但 MUST 要求已选项目上下文。

#### Scenario: 专家设置可见

- **WHEN** 用户在专家设置页查看「项目与分镜管理」分组
- **THEN** 出现上述四个工具名

#### Scenario: 未选项目

- **WHEN** 顶栏未选项目时调用任一新写工具
- **THEN** 返回与既有画布动作工具相同的「请先选择项目」错误