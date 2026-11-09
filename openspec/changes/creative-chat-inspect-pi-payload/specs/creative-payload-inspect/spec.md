# Spec Delta

## Purpose

让用户在发送前核对创意会话将交给模型的 system、合成 user 与工具集，且预览必须与真实发送一致。

## ADDED Requirements

### Requirement: 创意会话提供查看将发送入口

系统 SHALL 在创意视图头部提供「查看将发送」入口。展开后 MUST 在聊天主区域上方或并列展示检查器，MUST NOT 用独立弹窗替代（与工作台 Pi 聊天一致）。

#### Scenario: 打开发送预览

- **WHEN** 用户点击「查看将发送」
- **THEN** 检查器展开，并显示下一轮发送将使用的载荷摘要

#### Scenario: 收起预览

- **WHEN** 用户再次点击或点关闭
- **THEN** 检查器收起，对话区恢复全高

### Requirement: 检查器展示 system 与合成 user

检查器 SHALL 展示完整 system 字符串，以及即将送入模型的 user 字符串（含 `【之前的对话】` 历史块与当前输入框草稿；无草稿时仅展示历史块或空态说明）。

#### Scenario: 有历史与草稿

- **WHEN** 会话已有消息且输入框有未发送文字
- **THEN** 检查器 user 区展示与 `runStageAgent` 将拼接的同一字符串（历史 + 本轮草稿）

#### Scenario: 无历史

- **WHEN** 空会话且输入框有文字
- **THEN** user 区仅展示该草稿，不含 `【之前的对话】` 前缀

### Requirement: 检查器展示工具列表且不展示 SKILL 全文

检查器 SHALL 列出当前宿主与只读技能合并后的工具名；MUST NOT 内联宿主或只读技能的 SKILL.md 正文。系统提示中 MUST 说明技能正文由 `read_skill` 在运行时读取。

#### Scenario: 工具列表

- **WHEN** 用户打开检查器且宿主技能已加载
- **THEN** 可见按字母或声明顺序排列的工具 id 列表，且包含 `read_skill`

#### Scenario: 无技能

- **WHEN** 宿主技能加载失败
- **THEN** 检查器禁用或标明不可用，与发送按钮禁用一致

### Requirement: 预览与真发共用同一组装函数

应用 MUST 通过单一纯函数（或等价模块）从「当前宿主、只读技能、消息列表、输入草稿」生成 `{ system, userForModel, toolIds }`。`run()` 与检查器 MUST 调用同一函数，MUST NOT 各写一套拼接逻辑。

#### Scenario: 发送后一致

- **WHEN** 用户在检查器打开状态下发送消息
- **THEN** 实际请求中的 system 与 user 与检查器展示一致（除发送后历史递增）

#### Scenario: 切换技能后刷新

- **WHEN** 用户更换宿主技能
- **THEN** 检查器在未发送前自动刷新 system 与工具列表，历史块不变
