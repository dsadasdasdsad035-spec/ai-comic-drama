# Spec Delta

## ADDED Requirements

### Requirement: 转场参考工具纳入平台工具清单与专家白名单

系统 SHALL 把 `attach_transition_refs` 与 `set_transition_audio` 列入平台内置工具名清单，使专家设置页、创意检查器与技能可声明工具集都能看到它们；默认专家工具集 MUST 包含这两个工具，三套内置专家 MUST 一并勾选。

#### Scenario: 专家设置页可见

- **WHEN** 用户在专家设置页查看画布/物料分组
- **THEN** 分组中出现"转场参考"与"转场音频"两个工具

#### Scenario: 内置专家包含新工具

- **WHEN** 加载任一内置全能专家
- **THEN** 其工具白名单包含这两个转场写入工具

#### Scenario: 未授权时调用被拒

- **WHEN** 某自定义专家未勾选这两个工具却尝试调用
- **THEN** 运行时按既有授权规则拒绝，并提示去专家设置勾选
