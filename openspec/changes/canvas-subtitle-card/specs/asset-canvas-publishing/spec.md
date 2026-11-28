# Spec Delta

## ADDED Requirements

### Requirement: 画布可发布字幕素材卡

用户从设定/素材发布流程新建画布素材时，系统 MUST 支持创建字幕类型素材卡（与图片/音频并列的生成类入口，或明确「新建字幕卡」入口）。

#### Scenario: 新建字幕卡入口

- **WHEN** 用户在画布使用新建字幕素材卡入口
- **THEN** 创建 `kind` 为字幕的素材卡节点