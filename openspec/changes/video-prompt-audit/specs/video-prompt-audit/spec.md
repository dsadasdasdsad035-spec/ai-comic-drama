# Spec Delta

## Purpose

定义视频提示词内容合规审计：按分镜事实推导本镜应当满足的检查项，给出三级判定与可解释证据，并在硬项不合规时阻断 Agent 把提示词写回项目。

## ADDED Requirements

### Requirement: 审计结果必须区分不适用、通过与不通过

审计结果 SHALL 逐项返回 `applicable`、`ok` 与 `level` 三个独立字段。`applicable` 为假表示本镜不涉及该项，MUST NOT 计入问题数、MUST NOT 阻断写回；`applicable` 为真且 `ok` 为假时才构成问题。系统 MUST NOT 用单一布尔或纯字符串列表表达审计结果，因为那样无法区分「本镜不需要」与「本镜需要但没写」。

#### Scenario: 无台词的镜头不查口型

- **WHEN** 某镜 `dialogue` 为空
- **THEN** 口型检查返回 `applicable: false`，不计入问题数，也不出现在待修列表

#### Scenario: 有台词但没写口型

- **WHEN** 某镜 `dialogue` 非空且视频正文未出现任何口型或发声描写
- **THEN** 口型检查返回 `applicable: true, ok: false`，并带 `level: error`

#### Scenario: 适用且通过

- **WHEN** 某镜 `size` 非空且正文命中景别词
- **THEN** 景别检查返回 `applicable: true, ok: true`

### Requirement: 检查项适用性由分镜事实推导

每项检查的 `applicable` SHALL 由本镜既有字段推导，MUST NOT 依赖人工勾选清单。推导输入至少包含 `dialogue`、`cast`、`performance`、`size`、`move`、`seconds`、`scene_slug`、`desc`、`video_prompt`、解析后的参考集，以及相邻镜的起手字段。新增检查项 MUST 声明自己的适用条件。

#### Scenario: 环境声由剧本事实触发

- **WHEN** 该镜所属场次 `beats` 或 `desc` 命中天气或环境音事实（如暴雨、雷鸣、车流）
- **THEN** 环境声检查 `applicable: true`，并进入正文声音描写判定

#### Scenario: 无环境事实时跳过

- **WHEN** 该镜场次与描述均不含任何天气或环境音事实
- **THEN** 环境声检查 `applicable: false`，MUST NOT 因正文未写雨声而报错

#### Scenario: 角色检查跟随选角

- **WHEN** 该镜 `cast` 为空
- **THEN** 角色外观锚点检查与角色一致性检查均 `applicable: false`

### Requirement: 结构完整性检查

审计 SHALL 覆盖正文的结构完整性：景别、运镜、动作链与占位套话。景别词表 MUST 取自相机库 `mapsToSize` 枚举，运镜词表 MUST 取自 `mapsToMove` 枚举，MUST NOT 另建与项目用词不一致的平行词表。动作链检查 MUST 要求正文存在至少一处可执行的动词性动作片断，纯氛围或纯静态描写不得判为通过。

#### Scenario: 声明了景别但正文没写

- **WHEN** 该镜 `size` 为 `中景`，正文未出现任何 `mapsToSize` 词或同义表述
- **THEN** 景别检查报 `error`，`evidence` 指明正文缺失

#### Scenario: 固定机位不误报

- **WHEN** 该镜 `move` 为 `固定`，正文写「机位保持稳定」或「构图不动」
- **THEN** 运镜检查判为通过

#### Scenario: 正文只有氛围

- **WHEN** 正文仅描述光线、天气与陈设，不含任何主体动作
- **THEN** 动作链检查报 `error`

#### Scenario: 占位套话被识别

- **WHEN** 正文包含由模板产生的占位串（如「与动作结束状态一致」）
- **THEN** 占位检查报 `error`，`evidence` 给出命中原文

### Requirement: 结尾衔接检查

审计 SHALL 检查本镜正文是否写明终点姿态与持物归属，并 SHALL 在与下一镜对比时检查本镜终点是否与下一镜起手矛盾。这两项因依赖中文语义判定，首发 `level` MUST 为 `warn`，MUST NOT 阻断写回；在真实项目样本上完成误报率评估后，才允许提升为 `error`。

#### Scenario: 正文无终点状态

- **WHEN** 正文结尾只写离开、转身或推门等过程动作，没有定格姿态
- **THEN** 终点姿态检查报 `warn` 并给出补充示例

#### Scenario: 与下一镜矛盾

- **WHEN** 本镜终点写人物右手持伞，下一镜起手写该人物双手空着且无交接动作
- **THEN** 衔接检查报 `warn`，`evidence` 同时列出两侧原文

#### Scenario: 末镜不查下一镜

- **WHEN** 本镜是该集最后一镜
- **THEN** 衔接检查 `applicable: false`，只保留终点姿态检查

### Requirement: 表演与声音检查

审计 SHALL 检查有台词时的口型描写、音色参考与说话人一致性、需要音频时音频是否就绪、按角色分条的动作表演是否被正文覆盖、环境声是否与剧本事实对应，以及多人同框时表演是否同质化。有台词但音色参考指向非说话角色 MUST 判为 `error`。

#### Scenario: 有台词无口型

- **WHEN** 该镜 `dialogue` 非空且正文无口型或发声描写
- **THEN** 口型检查报 `error`

#### Scenario: 音色指向错误角色

- **WHEN** 音画同出模式下 `audio_ref.character` 不在该镜说话人集合内
- **THEN** 音色一致检查报 `error`，`evidence` 列出音色角色与说话人

#### Scenario: 剧情有雨但正文无声

- **WHEN** 场次 `beats` 写明暴雨，正文无任何雨声、雷声或水声描写
- **THEN** 环境声检查报 `error`

#### Scenario: 多人表演同质化

- **WHEN** 该镜 `cast` 至少两人，正文对所有人的表演使用同一情绪表述
- **THEN** 表演差异检查报 `warn`

#### Scenario: 有台词未配音频

- **WHEN** 该镜 `dialogue` 非空、尚无成片且音轨模式为静音路线，配音尚未生成
- **THEN** 音频就绪检查报 `warn`，提示配音缺失

### Requirement: 参考一致性检查

审计 SHALL 检查入画角色是否具备外观锚点、场次与道具是否已有对应参考、正文是否说明了所挂参考的用途，以及图生/文生模式与参考集是否自相矛盾。有参考图但正文与参考无任何关联说明 MUST 报 `warn`；正文声称图生但参考集为空、或正文依赖参考细节却无参考 MUST 报 `error`。

#### Scenario: 角色缺外观锚点

- **WHEN** `cast` 非空且该角色有 `lookEn`，正文未包含该锚点
- **THEN** 角色锚点检查报 `error`

#### Scenario: 挂图未说明用途

- **WHEN** 参考集非空且正文无任何参考、依照或沿用类说明
- **THEN** 参考说明检查报 `warn`

#### Scenario: 模式与参考矛盾

- **WHEN** 正文写「参考首帧」或依赖既有画面延续，但参考集为空
- **THEN** 模式匹配检查报 `error`

#### Scenario: 无参考但不依赖参考

- **WHEN** 参考集为空且正文以完整环境与人物外观自足描述
- **THEN** 模式匹配检查通过

### Requirement: 生成风险检查

审计 SHALL 检查标秒分段之和是否等于镜头时长、同一时段是否同时出现固定与移动运镜、多人同框是否缺站位说明、打戏是否分回合、画面文字是否存在乱码风险、是否包含 AI 高损耗动作，以及正文中的人物发声引文是否出自剧本定稿。除发声引文守真为 `error` 外，其余风险项 MUST 为 `warn`。

#### Scenario: 时段合计不等于镜长

- **WHEN** 正文标秒分段相加与该镜 `seconds` 不相等
- **THEN** 时长检查报 `warn`，`evidence` 列出分段合计与镜长

#### Scenario: 同时段运镜矛盾

- **WHEN** 同一标秒时段内同时出现固定机位与推近或横移指令
- **THEN** 运镜冲突检查报 `warn`

#### Scenario: 编造台词

- **WHEN** 正文中出现由说话引导词或标签引出的发声引文，且该文本不在剧本、视觉设定或分镜定稿中
- **THEN** 引文守真检查报 `error`

### Requirement: 硬项不合规必须阻断写回并返回可执行清单

`submit_prompts` 在任一 `applicable` 且 `ok: false` 的 `error` 级检查存在时 SHALL 拒绝写入项目，MUST NOT 部分写入、MUST NOT 静默降级为提示。失败回执 MUST 携带完整 `checks[]`，每项含 `id`、`level`、`applicable`、`ok`、`evidence` 与 `hint`，使调用方无需二次查询即可定位与改写。仅含 `warn` 级问题时 MUST 允许写入并随回执返回提示。

#### Scenario: 硬项失败被拒

- **WHEN** Agent 提交的视频正文存在环境声缺失
- **THEN** 写回被拒绝，回执含该项 `evidence`（剧本原文）与 `hint`（应补写什么），项目内提示词保持原值

#### Scenario: Agent 依据回执重写

- **WHEN** Agent 收到含 `checks[]` 的失败回执并重新提交合规正文
- **THEN** 写回成功，回执只含已通过的项或剩余 `warn`

#### Scenario: 仅告警仍写入

- **WHEN** 审计只返回 `warn` 级问题
- **THEN** 写回成功，回执列出告警项

#### Scenario: 不适用项不阻断

- **WHEN** 所有 `error` 级检查的 `applicable` 均为假
- **THEN** 写回不被阻断

### Requirement: 审计输出必须可解释

每项不通过的检查 SHALL 提供 `evidence` 与 `hint`。`evidence` MUST 引用项目内的可核对原文（场次 beats、镜头描述、正文片段或相邻镜字段），MUST NOT 只给抽象结论；`hint` MUST 说明具体应补写什么，MUST NOT 复制正文或给出与检查无关的建议。

#### Scenario: 证据可回溯

- **WHEN** 环境声检查失败
- **THEN** `evidence` 含触发该项的剧本原文片段，`hint` 指明需补写的声音类型

#### Scenario: 不给出空提示

- **WHEN** 任一检查失败
- **THEN** `hint` 非空且指向该镜可执行的修改方向

### Requirement: 审计判定必须可复用于多个消费点

审计 MUST 实现为不依赖浏览器或服务端专有模块的纯函数，使 Agent 写回、画布界面与服务端统计复用同一判定，MUST NOT 为不同入口各写一份判定导致口径漂移。

#### Scenario: 工具与界面口径一致

- **WHEN** 同一镜头在 Agent 写回与画布面板分别审计
- **THEN** 两次返回的检查项 id、`applicable` 与 `ok` 完全一致

#### Scenario: 审计不产生副作用

- **WHEN** 仅执行审计而未触发写回
- **THEN** 项目数据与镜头字段保持不变
