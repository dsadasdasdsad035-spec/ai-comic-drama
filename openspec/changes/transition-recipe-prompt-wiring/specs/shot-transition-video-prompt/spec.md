# Spec Delta

## ADDED Requirements

### Requirement: 食谱参与自动拼装

当转场配置带有 `generated.recipeIds` 时，自动出片正文 MUST 追加一层来自命中食谱卡的内容：优先取该卡的 `seedanceHints` 逐条成句，缺失时退到 `principle`。同一个 `recipeId` 重复出现 MUST 只取一次；未知 id MUST 忽略且不报错。无 `recipeIds` 时正文 MUST 与未引入食谱层时完全一致。

#### Scenario: 命中卡写入 hints

- **WHEN** 转场带 `recipeIds: ["circle-match-iris"]` 且该卡有 `seedanceHints`
- **THEN** 正文出现该卡的完整句子，且每条只出现一次

#### Scenario: 无卡时正文不变

- **WHEN** 转场没有任何 `recipeIds`
- **THEN** 正文与引入食谱层之前的拼装结果逐字相同

#### Scenario: 未知 id 被忽略

- **WHEN** `recipeIds` 含一个不存在的卡 id
- **THEN** 拼装不报错，该 id 不产生任何正文内容

### Requirement: 技法卡变体选择

`kind: technique` 的卡 MUST 支持 `generated.variantId` 指定变体。命中变体时正文 MUST 使用该变体的 `principle`；未指定变体时 MUST 降级为卡级 `seedanceHints`，并给出「技法卡未指定变体」的 warning。变体 id 不属于该卡时 MUST 视为未指定。

#### Scenario: 指定变体

- **WHEN** 卡 `shot-transitions` 配 `variantId: "portal-wipe"`
- **THEN** 正文使用「穿窗纵深」的 principle，且不出现其它两式的描述

#### Scenario: 未指定变体

- **WHEN** 技法卡命中但 `variantId` 为空
- **THEN** 正文使用卡级 hints，warnings 含未指定变体的提示

### Requirement: 已知坑转负向约束

命中卡与变体的 `pitfalls` MUST 合并去重后作为一段「避免」约束追加在正文末尾。该段 MUST NOT 出现在手改正文（`videoPromptOverride`）中。

#### Scenario: 坑进正文

- **WHEN** 命中卡的 `pitfalls` 含「锚点必须是真圆」
- **THEN** 正文末尾出现对应的避免项

#### Scenario: 手改不受影响

- **WHEN** 用户保存了手改正文
- **THEN** 请求正文与手改文本逐字相同，不含食谱层与负向约束

### Requirement: 附件注记与实际提交一致

正文中的结构锚点、参考图与参考视频注记 MUST 只描述本次真的会提交的附件。被互斥规则省略的参考图 MUST NOT 出现在正文的参考图注记中；其省略原因 MUST 仅在清单与 warning 中说明。

#### Scenario: 互斥时不宣称参考图

- **WHEN** 首尾帧齐全导致参考图被互斥省略
- **THEN** 正文不出现「参考图：[图N]=…」，且 `refImages` 为空

#### Scenario: 非互斥时注记齐全

- **WHEN** 本次提交参考图
- **THEN** 正文的参考图注记条数与 `refImages` 数量一致
