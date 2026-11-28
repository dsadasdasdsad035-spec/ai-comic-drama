# Spec Delta

## REMOVED Requirements

### Requirement: 字幕卡保存 cue 列表

**Reason**：交付物改为 SRT 正文，不再以结构化 cue 为权威数据源。

**Migration**：加载资产时若存在 `cues` 且无 `srtBody`，系统 MUST 用与导出相同的规则序列化为 `srtBody` 并停止向 UI 暴露 cue；之后保存项目不再写入 `cues`。

### Requirement: 可选文本模型生成或改写

**Reason**：替换为「直接生成 SRT」，不再更新 cue 列表。

**Migration**：原「生成 cue」按钮与行为由「生成 SRT」取代。

## MODIFIED Requirements

### Requirement: 可导出 SRT 片段

用户 MUST 能从字幕卡下载 SRT 文件。内容 MUST 来自该卡当前保存的 SRT 正文（或生成后立即下载的同一份正文）。无有效字幕正文时 MUST 提示而非导出空文件。

#### Scenario: 已有 SRT 正文时下载

- **WHEN** 字幕卡已保存非空 SRT 正文，用户请求下载
- **THEN** 浏览器下载 UTF-8（含 BOM）的 `.srt` 且内容与保存的正文一致

#### Scenario: 生成后立即下载

- **WHEN** 用户成功完成「生成 SRT」
- **THEN** 系统保存该 SRT 正文到该卡且用户可下载同一文件

#### Scenario: 无正文时拒绝

- **WHEN** 字幕卡没有非空 SRT 正文且用户请求下载
- **THEN** 系统不下载文件并提示先连线分镜并生成

### Requirement: 不写回镜头 dialogue

字幕卡的生成或保存结果 MUST NOT 自动写入任何镜头的 `dialogue` 或其它镜头字段。

#### Scenario: 生成 SRT 不改变镜头

- **WHEN** 用户从字幕卡生成或保存 SRT
- **THEN** 被引用分镜的 `dialogue` 保持不变

## ADDED Requirements

### Requirement: 文本模型直接生成 SRT

字幕卡 MUST 提供「生成 SRT」操作：在已连线至少一个分镜、且用户已配置可用文本模型时，将选定分镜字段与可选说明作为输入，调用文本能力，得到 **SRT 格式全文** 并保存为该卡的 SRT 正文。生成失败时 MUST 保留原有 SRT 正文（若有）并提示原因。

#### Scenario: 成功生成

- **WHEN** 用户选择已配置文本模型、已连线分镜，并请求生成 SRT
- **THEN** 系统调用文本能力、校验结果为可解析 SRT、写入该卡并可供下载

#### Scenario: 未连线分镜

- **WHEN** 用户请求生成 SRT 但未连线任何分镜
- **THEN** 系统不调用模型并提示先连线分镜

#### Scenario: 模型返回不可解析内容

- **WHEN** 文本能力返回的内容无法按 SRT 规则校验
- **THEN** 系统不覆盖已保存正文并提示重试或更换模型

### Requirement: 字幕卡持久化 SRT 正文

字幕卡 MUST 在项目素材中保存 SRT 正文字符串。重新打开项目后 MUST 可预览并下载同一正文。

#### Scenario: 重开后 SRT 仍在

- **WHEN** 用户生成 SRT 并保存项目后重新打开
- **THEN** 该卡仍显示已保存的 SRT 正文并可下载

### Requirement: 字幕卡不提供 cue 编辑界面

字幕卡 Inspector MUST NOT 提供 cue 列表编辑、规则填充 cue、或「生成 cue」入口。

#### Scenario: 无 cue 控件

- **WHEN** 用户选中字幕素材卡
- **THEN** 界面没有 cue 行编辑、添加 cue、或规则填充按钮