# Spec Delta

## REMOVED Requirements

### Requirement: 自动正文追加衔接约束

**Reason**: 转场正文应当完全由人/Agent 决定。系统在运行时按两镜字段推导衔接句并追加进正文，导致用户写进去的文字永远不等于发出去的正文，排查出片偏差时要先分辨哪一段是系统加的。衔接信息改由 Agent 在写正文时自行组织；面板仍以只读方式展示推导结果供人参考，但不参与发送。

**Migration**: 已有 `generated.prompt` 与 `videoPromptOverride` 数据不变，无需迁移。用户若希望保留原先自动得到的衔接描述，需在出片前把它手工并入正文（面板只读区可直接复制）。已出片的转场 `videoMeta.prompt` 为旧格式，与新预览不一致，需重新出片才对齐。

## ADDED Requirements

### Requirement: 衔接约束以只读形式展示

系统 MUST 在生成转场面板上展示由相邻两镜已有字段推导的衔接信息，并 MUST 明确标注该信息不参与出片。衔接信息 MUST NOT 出现在 `/api/seedance` 请求的 `prompt` 中。推导 MUST 覆盖已有数据能支持的景别跨度、运镜方向与动作衔接；缺少对应字段时 MUST 省略该项，MUST NOT 编造景别或机位。

#### Scenario: 只读展示不改变正文

- **WHEN** 用户打开一条有景别与运镜数据的生成转场，且 `generated.prompt` 非空
- **THEN** 面板可见衔接信息折叠区并标注「不参与发送」，出片正文与 `generated.prompt` 逐字相同

#### Scenario: 字段缺失则省略对应行

- **WHEN** 某一镜没有景别或没有运镜
- **THEN** 只读区省略该项，MUST NOT 编造景别或机位

#### Scenario: 手改正文时不展示自动衔接

- **WHEN** 转场已保存手改正文
- **THEN** 面板不展示自动衔接只读区，出片仍逐字发送手改正文
