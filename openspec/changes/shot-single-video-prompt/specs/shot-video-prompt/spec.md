# Spec Delta

## MODIFIED Requirements

### Requirement: AI 重写不覆盖手改提示词

`video_prompt` 一旦被人工编辑并记入 `handEdited`，MUST 作为镜头的手改字段参与重新拆镜和提示词重写合并；模型重新生成 `video_prompt` 时 MUST 保留人工正文，直到用户主动清除该字段的手改标记。

#### Scenario: 重新生成提示词

- **WHEN** 用户在镜头表或通过 Inspector 关联的出片流程重新生成该镜头的 `video_prompt`，且该字段已在 `handEdited` 中
- **THEN** 该镜头的正文保持不变，面板继续显示人工版本

#### Scenario: 未手改时正常覆盖

- **WHEN** 该镜 `video_prompt` 从未被人工编辑
- **THEN** 模型重新生成提示词时正常写回该字段

## ADDED Requirements

### Requirement: 出片正文只有一个来源

出片正文 MUST 只来自该镜 `video_prompt` 经裁剪后的全文。系统 MUST NOT 在运行时拼装、追加或回退到其他字段；`prompt`、`video_prompt_rendered` 及 `video_prompt_render_meta` MUST NOT 参与正文选择。`video_prompt` 为空且无存量手改快照时 MUST 阻止出片并给出补写入口。

#### Scenario: 有正文即逐字使用

- **WHEN** 镜头 `video_prompt` 非空
- **THEN** 出片正文为该字段全文，不追加任何段落

#### Scenario: 正文为空阻断出片

- **WHEN** 镜头 `video_prompt` 为空且无存量手改快照
- **THEN** 出片被阻止，面板提示在正文区补写

#### Scenario: 忽略陈旧九段层

- **WHEN** 镜头存有 `video_prompt_rendered` 且 `video_prompt` 非空
- **THEN** 出片正文为 `video_prompt`，面板不显示「模板渲染过期」类警告

#### Scenario: 画面提示词不回落

- **WHEN** 镜头 `video_prompt` 为空但 `prompt` 非空
- **THEN** 出片仍被阻止，MUST NOT 用 `prompt` 顶替正文

### Requirement: 正文在出片面板内编辑并写回本镜

系统 SHALL 只提供一处正文编辑入口，位于出片面板内；保存后正文 MUST 写入该镜 `video_prompt`，并把 `video_prompt` 记入 `handEdited`。生成 MUST 逐字发送该版本，刷新页面和重新打开项目后 MUST 仍保留。系统 MUST NOT 新建或更新 `video_prompt_override`。

#### Scenario: 编辑保存后生成

- **WHEN** 用户在出片面板编辑正文并保存，然后点生成
- **THEN** 请求的 `prompt` 等于保存的全文，且落库字段为 `video_prompt`

#### Scenario: 重新打开项目

- **WHEN** 用户保存正文后刷新页面或重新打开项目
- **THEN** 该镜头仍显示保存的正文，并标出正文已由人工编辑

#### Scenario: 单一可编辑入口

- **WHEN** 用户选中出片镜并查看出片 Tab
- **THEN** 正文只在出片面板内可编辑；运镜与语义区块不提供第二个正文输入框

#### Scenario: 取消人工编辑

- **WHEN** 用户在出片面板点「交由模型重写」并触发一次保存
- **THEN** 该镜 `handEdited` 中的 `video_prompt` 被真正移除（落库后不再含该字段），正文本身保留，下一次模型重写可以覆盖它

### Requirement: 手改锁只能被显式解锁

`handEdited` 的常规合并 MUST 保持并集语义（只增不减），使模型写回不会意外解除人工编辑。系统 MUST 提供显式解锁通道：提交载荷携带待解锁字段清单时，服务端 MUST 从 `handEdited` 移除这些字段，MUST 保留其余标记，且该清单 MUST NOT 落库。

#### Scenario: 普通保存不清锁

- **WHEN** 画布保存某镜但未携带解锁清单
- **THEN** 该镜既有的 `handEdited` 标记全部保留，即使本次载荷里的数组更短

#### Scenario: 显式解锁只移除指定字段

- **WHEN** 载荷携带解锁 `video_prompt`，该镜 `handEdited` 原为 `['seconds', 'video_prompt']`
- **THEN** 落库结果为 `['seconds']`，`seconds` 仍受保护

#### Scenario: 解锁清单不落库

- **WHEN** 一次带解锁清单的保存完成
- **THEN** 读取该镜时不存在解锁清单字段，只有更新后的 `handEdited`

### Requirement: 存量手改快照只读兼容

升级前已保存 `video_prompt_override` 的镜头 MUST 继续按该快照逐字出片，MUST NOT 丢失或静默改写已存文本。用户在新的正文区编辑并保存后，正文 MUST 落到 `video_prompt` 并使旧快照不再生效。

#### Scenario: 存量快照继续出片

- **WHEN** 一个旧项目镜头存在非空 `video_prompt_override`
- **THEN** 出片正文为该快照全文，面板标明这是旧版本保存的正文

#### Scenario: 新保存接管旧快照

- **WHEN** 用户在正文区编辑保存一个仍带旧快照的镜头
- **THEN** 新正文写入 `video_prompt`，旧快照不再参与出片

#### Scenario: 保存不再产生快照

- **WHEN** 用户任意保存一次正文
- **THEN** 系统 MUST NOT 新建或更新 `video_prompt_override`

### Requirement: 带参考视频的正文只约束运动

为带参考视频的镜头撰写正文时，MUST 把参考视频描述为运动、机位、节奏或走位参考，MUST NOT 要求画面风格、人物外观、场景或道具与该视频一致。系统 MUST NOT 在运行时自动追加该类说明；视频附件始终按实际连线提交，措辞由撰写方负责。

#### Scenario: 撰写带视频参考的正文

- **WHEN** 镜头连线视频素材且由人或 Agent 撰写正文
- **THEN** 正文可出现「视频1只参考运动/机位/节奏，外观以参考图和文字为准」一类限定，不出现要求外观一致的总句

#### Scenario: 正文未提及视频参考

- **WHEN** 用户保存的正文完全没有提及参考视频
- **THEN** 视频仍作为 `reference_video` 提交，面板附件清单仍列出它，系统不追加说明文字

## REMOVED Requirements

### Requirement: 手改提示词保存到本镜并逐字使用

**Reason**: 手改正文不再存入独立字段，改为写回 `video_prompt` 并由 `handEdited` 保护；「清除手改并恢复自动拼装」在新模型下没有对应动作。

**Migration**: 见「正文在出片面板内编辑并写回本镜」与「存量手改快照只读兼容」。存量 `video_prompt_override` 保持只读生效，用户保存一次正文即迁移到 `video_prompt`。

### Requirement: 手改快照在输入变化后标记过期

**Reason**: 正文收敛为单一来源后，人工内容与被编辑对象是同一份数据，不存在「快照与当前输入不一致」的状态；保留该提示会要求用户在单份正文上做无意义的「重新拼装」。

**Migration**: 存量 `video_prompt_override` 继续只读生效并标注为旧版本正文；其 `fingerprint` 与 `createdAt` 仅作为历史数据保留，不再驱动界面警告。

### Requirement: 自动正文优先级

**Reason**: 运行时拼装已在 4a5b79b 删除，正文不再有多级优先级链；`prompt` 回退与脚本拼装兜底同时失效。

**Migration**: 改为「出片正文只有一个来源」。`video_prompt` 为空的镜头此前靠 `prompt` 回退或脚本拼装出片，升级后会被阻止，需补写一次正文。

### Requirement: 恢复自动拼装含脚本路径

**Reason**: 正文不再有「自动拼装结果」可恢复；该操作随拼装层一并移除。

**Migration**: 需要重写正文时直接在正文区编辑保存；需要模型重写时清除 `video_prompt` 的手改标记后重新提交提示词。

### Requirement: 视频素材的提示词只约束运动

**Reason**: 该需求的「自动拼装时由系统写入限定句」部分随拼装层删除而失效；约束本身仍然有效，但已成为撰写规则而非运行时行为。

**Migration**: 见「带参考视频的正文只约束运动」。
