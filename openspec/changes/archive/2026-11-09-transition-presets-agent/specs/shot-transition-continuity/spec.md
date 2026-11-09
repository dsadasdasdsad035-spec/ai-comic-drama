# Spec Delta

## MODIFIED Requirements

### Requirement: 自动正文追加衔接约束

系统 MUST 在生成转场且未使用手改正文时，把由相邻两镜已有字段推导的衔接约束追加到自动提示词中。约束 MUST 覆盖已有数据能支持的景别跨度、运镜方向和动作从上一镜落到下一镜起点。当 `generated.prompt` 已由 Agent 建议写入非空自定义短提示时，自动衔接段 MUST 仍追加在基础句之后、除非用户整段使用 `videoPromptOverride`。

#### Scenario: Agent 写入视觉短提示后自动衔接仍存在

- **WHEN** 用户应用 Agent 建议填写了 `generated.prompt`，且未设置 `videoPromptOverride`
- **THEN** 最终自动正文包含 Agent 短提示、衔接约束段与 morph/keyframe 尾句

#### Scenario: 两镜都有景别与运镜

- **WHEN** 用户查看或提交一条生成转场，且未填写手改正文，两镜都有景别和运镜
- **THEN** 最终发送正文包含这两镜的景别与运镜，并要求画面从上一镜结束落到下一镜开始

#### Scenario: 字段缺失则省略对应句

- **WHEN** 某一镜没有景别或没有运镜
- **THEN** 正文省略该项，MUST NOT 编造景别或机位
