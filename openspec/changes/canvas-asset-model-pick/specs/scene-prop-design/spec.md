# Spec Delta

## ADDED Requirements

### Requirement: 素材页设定图生成可选择图像模型

用户在素材页对场景或道具设定卡发起设定图生成时，系统 MUST 在素材页界面提供图像能力模型选择。未手选时 MUST 使用设置页 `image` 能力默认；手选 MUST 与画布图片素材卡共用本机图像模型覆盖。

#### Scenario: 素材页顶栏选择模型

- **WHEN** 用户在素材页场景或道具分类下准备生成设定图
- **THEN** 用户可在同一视图内选择图像模型，无需进入设置页

#### Scenario: 与画布出图手选一致

- **WHEN** 用户在画布图片素材卡 Inspector 手选图像模型后切换到素材页生成设定图
- **THEN** 设定图生成使用同一 modelKey