# video-prompt-refine-chat Delta

## ADDED Requirements

### Requirement: 改稿弹窗入口

分镜出片提示词面板与转场「本次出片提示词」区域 SHALL 提供「与模型改稿」或等价入口，打开模态弹窗。弹窗 MUST 包含对话区与发送能力；MUST NOT 要求离开 Inspector 才能改稿。

#### Scenario: 分镜打开改稿

- **WHEN** 用户在某分镜出片提示词面板点击改稿入口
- **THEN** 弹窗标题或摘要含镜号，对话线程绑定该镜

#### Scenario: 转场打开改稿

- **WHEN** 用户在两条分镜之间的生成转场面板点击改稿入口
- **THEN** 对话线程绑定该接缝（上镜号与下镜号）

### Requirement: Pi 运行时与写回

改稿弹窗 SHALL 使用与其它工作台相同的 Pi 循环（原生 tool calling）。宿主 MUST 注册 refine 技能及写回工具；成功写回 MUST 更新 `video_prompt_rendered` 或转场 `generated.renderedPrompt` 与 `render_meta`（含 fingerprint），MUST NOT 静默写入 `video_prompt_override` 除非用户显式选择写入手改层。

#### Scenario: 工具写回单镜

- **WHEN** 模型调用写回工具提交某镜渲染正文且 fingerprint 与当前 bundle 一致
- **THEN** 该镜持久化新 `video_prompt_rendered`，面板正文更新为模板渲染来源

### Requirement: 上下文检查器

弹窗 SHALL 提供「发给模型的上下文」检查器，形态与工作台 Pi「查看将发送」一致或扩展。检查器 MUST 展示：Pi 引导摘要、当前 refine 技能 id 与 source（builtin/override）、设置生效的 role 与 task 全文、本轮合成 user（含历史前缀与草稿）、已绑定工具名列表、当前 `PromptRenderBundle` 摘要或只读引用说明。用户 MUST 可复制各片段。

#### Scenario: 发送前预览设置模板

- **WHEN** 用户在输入框输入改稿指令但尚未发送
- **THEN** 检查器 task/system 区仍显示将随下轮使用的设置生效 role/task（含用户覆盖）

#### Scenario: 设置覆盖可见

- **WHEN** 技能为 override 来源
- **THEN** 检查器标明「用户覆盖」，并展示与内置不同的 task 或 role 文本

### Requirement: 聊天记录持久化

改稿对话 MUST 按项目隔离持久化；分镜线程键 MUST 与同项目其它聊天互不覆盖。刷新页面后 MUST 恢复同镜或同接缝的历史（除非用户清空线程）。

#### Scenario: 切换镜头保留各自历史

- **WHEN** 用户先后打开 S01 与 S02 的改稿弹窗
- **THEN** 各自显示独立对话历史，互不影响

#### Scenario: 项目切换隔离

- **WHEN** 用户打开另一项目的同名镜号改稿
- **THEN** 对话历史仅为该项目记录
