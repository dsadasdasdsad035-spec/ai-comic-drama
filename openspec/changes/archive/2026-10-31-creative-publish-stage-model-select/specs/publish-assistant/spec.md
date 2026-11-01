# Spec Delta

## ADDED Requirements

### Requirement: 发布助手可在聊天中手选文本模型

系统 SHALL 在发布助手聊天头部的上下文条提供文本模型下拉，对应环节 `publish`。手选 MUST 写入与其它工作台共用的本机环节手选存储；解析顺序 MUST 为手选 > 设置页 `stageModels.publish` > 「文本 · 常规」默认 > 文本族首条可运行模型。更换模型 MUST 从下一轮对话生效；头部 MUST 显示当前解析结果，无可用模型时 MUST 以可读错误态提示去设置页绑定。

#### Scenario: 手选模型

- **WHEN** 用户在发布助手头部从下拉选择某一文本模型
- **THEN** 本机手选记录更新，下一轮助手请求使用该模型键

#### Scenario: 跟随环节默认

- **WHEN** 用户将下拉选回「默认」且设置页已绑定发布环节默认
- **THEN** 助手对话使用设置页 `stageModels.publish` 解析出的模型

#### Scenario: 无文本模型

- **WHEN** 模型表中没有可运行的文本族模型
- **THEN** 下拉不可用，头部标明未配置文本模型，发送入口保持禁用
