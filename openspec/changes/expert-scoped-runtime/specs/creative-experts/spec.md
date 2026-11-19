## MODIFIED Requirements

### Requirement: 技能白名单通配

`skillIds` 含 `*` 时 SHALL 视为「该专家技能根内、且应用技能目录中已安装的全部技能」：列举与读取 MUST 仅限该集合；MUST NOT 因通配而跳过专家技能闸门或向模型暴露技能根外 id。占位符与 soul 文案 MAY 表述为「全部已安装技能（*）」但运行时集合 MUST 与专家技能根同步结果一致。

#### Scenario: 通配读技能

- **WHEN** 专家 `skillIds` 为 `["*"]` 且模型对技能根内某已安装 id 调用技能读取工具
- **THEN** 返回正文或文件，不返回「专家不允许读取技能」

#### Scenario: 通配读技能子文件

- **WHEN** 专家 `skillIds` 为 `["*"]` 且模型对技能根内 id 读取包内子文件
- **THEN** 按文件是否存在返回结果，不因通配而跳过白名单校验

#### Scenario: 通配仍拒绝根外技能

- **WHEN** 专家 `skillIds` 为 `["*"]` 且模型对不在该专家技能根内的技能 id 调用 `read_skill*` 或 `read_skill_file`
- **THEN** 返回 `ok:false`，理由指明该 id 不在此专家允许范围内

### Requirement: 专家模式运行时约束

当创意会话选中某专家时，系统 MUST 使用经编译处理的专家 `soul` 作为 system（不含 DSH 非法 `{{…}}` 占位符），MUST NOT 拼接默认模式的通用创意 system 或偏好技能说明。工具 MUST 为该专家 `toolIds` 与创意工具的交集加专家列举工具。技能列举与读取 MUST 仅允许该专家 `skillIds` 所解析出的 id 集合；`list_installed_skills` 的返回集 MUST 与 `read_skill*` / `read_skill_file` 可成功读取的集合一致。

#### Scenario: 发送预览一致

- **WHEN** 操作员查看该轮实际使用的 system 与工具列表
- **THEN** 与下一轮运行时一致，不出现仅存在于预览的额外段落

#### Scenario: 隐藏偏好技能

- **WHEN** 选中专家
- **THEN** 界面不出现默认模式的偏好技能选择入口

#### Scenario: 非白名单技能的子文件被拒绝

- **WHEN** 专家 `skillIds` 不含某 id 且模型对该 id 读取子文件
- **THEN** 返回 `ok:false`，不读取该技能任何文件

#### Scenario: 列表不泄露白名单外技能

- **WHEN** 专家 `skillIds` 为有限列表且模型调用 `list_installed_skills`
- **THEN** 返回的技能 id 均为白名单子集，不包含将被读取拒绝的 id

#### Scenario: 工具执行与可见集一致

- **WHEN** 专家会话中模型调用某平台工具名
- **THEN** 若该名不在专家 `toolIds` 与始终注入的 `list_experts` 之外，执行 MUST 在应用侧被拒绝并返回可读错误（即使宿主层限制失效）

## ADDED Requirements

### Requirement: 专家上下文经工具桥传递

当创意宿主在专家 preset 下执行平台工具时，系统 MUST 在工具桥请求中携带可解析的专家标识，使应用侧能对技能列举/读取与工具执行应用与 preset 相同的白名单。无专家 preset 时 MUST 省略该字段且不改变现有全量行为。

#### Scenario: 专家 preset 调用带上下文

- **WHEN** 会话使用 `expert-<id>` preset 且模型调用 `list_installed_skills`
- **THEN** 请求体含专家 id，响应仅含该专家允许的技能

#### Scenario: 无专家不带上下文

- **WHEN** 会话使用非专家 preset 且调用 `list_installed_skills`
- **THEN** 行为与变更前全库列举一致