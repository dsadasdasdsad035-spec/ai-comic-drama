# Spec Delta

## Purpose

规定凡是会进入模型请求、落库提示词或工具回执的文本必须原样传递，任何字符截断都必须显式、可追溯，且不改变持久化内容，从而使「看到的正文」与「实际发送的正文」始终一致。

## ADDED Requirements

### Requirement: 提示词正文原样传递

系统 MUST 把用户或 Agent 写入的提示词正文原样传入模型请求与落库字段，MUST NOT 施加固定字符数截断。派生正文（由镜头字段拼装、模板渲染或预填建议）同样 MUST 使用来源字段的完整文本。

#### Scenario: 预填建议使用完整邻镜提示词

- **WHEN** 用户点「用上下镜正文预填」且相邻两镜的视频提示词各超过 90 字符
- **THEN** 预填正文包含两镜提示词的完整文本，MUST NOT 出现 `…` 省略号，MUST NOT 在字符中途截断

#### Scenario: 模板渲染不切场景字段

- **WHEN** 单镜或转场的来源画面提示词超过 300 字符
- **THEN** 九段模板渲染 bundle 的 `scene.environment` 与 `scene.castStates` 保留完整文本

### Requirement: 空正文必须是可见状态

当一条生成类转场既没有 `generated.prompt` 也没有 `videoPromptOverride` 时，系统 MUST 把它作为可读状态呈现给用户，MUST NOT 用兜底正文静默顶替后按已填写处理。

#### Scenario: 未填写正文的转场

- **WHEN** 用户打开一条 `mode=generated` 且正文与手改正文均为空的转场
- **THEN** 面板标出该接缝「正文未填写」并给出补写入口，出片前该状态出现在阻止或警示列表中

### Requirement: 截断必须显式且可追溯

当运行约束确实要求裁剪（例如按条装填、按模型上下文动态预算）时，系统 MUST 在结果中标出截断事实、原始长度与续取方式，MUST NOT 用切片后的片段伪装成完整内容。

#### Scenario: 超长读取结果

- **WHEN** 单次读取结果超过当前运行预算
- **THEN** 结果返回完整条目与明确的截断标记，MUST NOT 把 JSON 或正文切成半截字符串返回

#### Scenario: 模板渲染正文可由 Agent 读取

- **WHEN** 某镜或某接缝已有模板渲染正文
- **THEN** 读取工具返回该正文全文，MUST NOT 仅返回字符数

### Requirement: 持久化内容不受显示裁剪影响

界面用于列表、标题或首行摘要的裁剪 MUST NOT 写回数据层，也 MUST NOT 改变请求正文。

#### Scenario: 首行摘要不落库

- **WHEN** 面板只展示正文首行摘要
- **THEN** 落库内容与请求正文仍为全文，重新打开项目后面板可展开看到完整文本
