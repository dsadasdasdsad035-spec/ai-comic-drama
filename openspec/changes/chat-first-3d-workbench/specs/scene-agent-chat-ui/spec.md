# Spec Delta

## MODIFIED Requirements

### Requirement: 现有参考内容与输入框保持可用

聊天 SHALL 保留当前镜头的参考内容 chips、移除操作和输入框；发送消息前 MUST 使用当前选择，MUST NOT 因为换用聊天 UI 而静默加入未选素材。参考内容只有一份：左侧勾选即聊天参考；移除 chip MUST 只取消对应勾选，不静默加入其他素材。没有参考时 MUST 显示从左侧添加的引导。

#### Scenario: 空参考

- **WHEN** 用户首次打开聊天且没有勾选任何参考
- **THEN** 参考条为空并提示从左侧添加，不显示任何未选素材

#### Scenario: 已选 chips

- **WHEN** 用户打开聊天
- **THEN** 当前参考内容仍以 chips 显示并可移除

#### Scenario: 发送前移除

- **WHEN** 用户移除一个 chip 后发送
- **THEN** 本次 agent 上下文不包含该素材，左侧对应勾选也取消

#### Scenario: 输入框

- **WHEN** agent 未运行
- **THEN** 用户可输入并发送，支持键盘快捷键

## ADDED Requirements

### Requirement: 聊天输入框预填镜头文本

当镜头有文本且该文本没有被选进参考时，聊天输入框 SHALL 预填可编辑的镜头文本草稿；草稿 MUST NOT 自动发送，MUST NOT 计入参考选择。用户清空后 MUST NOT 重新填充；发送后 MUST NOT 重复预填。

#### Scenario: 首次打开预填

- **WHEN** 用户首次打开一个有 prompt、台词或运动提示的镜头聊天
- **THEN** 输入框显示这些文本的可编辑草稿，发送按钮可用但不自动发送

#### Scenario: 清空后不复发

- **WHEN** 用户清空输入框并继续停留在聊天
- **THEN** 输入框保持为空，不重新填入镜头文本

#### Scenario: 发送预填文本

- **WHEN** 用户直接发送预填草稿
- **THEN** 文本作为用户消息进入对话，输入框清空且不再重复预填

#### Scenario: 文本已选为参考

- **WHEN** 镜头文本已经被选进参考
- **THEN** 输入框不重复预填同一文本
