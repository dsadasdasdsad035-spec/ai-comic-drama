# Spec Delta

## REMOVED Requirements

### Requirement: 风格参考可继承、排除与增补

**Reason**: 实现已恒关继承（`normalizeGenerated` 强制 `inheritRefs: false`），转场面板没有继承开关，存档里的 `excludeRefIds` 也不再参与出片。该 requirement 描述的"默认继承 + 关闭继承 + 逐项排除"与当前行为相反。

**Migration**: 参考改为显式选择：画布把连线拖到接缝边、转场面板勾选候选、或 Agent 调用 `attach_transition_refs`。旧存档的 `inheritRefs` 与 `excludeRefIds` 在读取时忽略，不影响出片，也不需要数据迁移。

## MODIFIED Requirements

### Requirement: 转场参考与边界高级编辑

边界路径手填与「抽取两镜成片帧」MUST 存在于转场工作台内，但 MUST 收纳在单一折叠区（如「转场参考与边界」），MUST NOT 在主 `vp-refs` 外再铺一套平行参考列表。主 `vp-refs` MUST 唯一展示结构首尾帧、合并图/视频参考与省略项。

#### Scenario: 无重复参考列表

- **WHEN** 用户扫读转场 gen-box
- **THEN** 参考条目只出现在本次出片提示词面板的 `vp-refs` 中一次

#### Scenario: 高级区可排除

- **WHEN** 用户展开转场参考折叠并移除一条已增补的参考
- **THEN** 主 `vp-refs` 与将提交计数即时更新

#### Scenario: 抽取只产候选

- **WHEN** 用户在该折叠区点「抽取两镜成片帧」
- **THEN** 结果只出现在首尾帧候选里，槽位与 `generated.boundary` 都不变

## ADDED Requirements

### Requirement: 转场参考只认显式选择

系统 MUST 只用转场 `generated.refIds` 中显式列出的 token 作为风格参考，MUST NOT 自动继承相邻两镜连线解析出的参考。候选池 MUST 由两镜手工 URL、项目角色外观与画布图片素材卡组成并去重；非图片素材与占位角色 MUST NOT 进入候选。

#### Scenario: 两镜连线不自动继承

- **WHEN** 两镜各自连着角色与场景参考，但转场 `generated.refIds` 为空
- **THEN** 该转场提交的风格参考为 0 项

#### Scenario: 只提交被点名的 token

- **WHEN** `generated.refIds` 只包含一张场景图的 token
- **THEN** 提交列表只有该图，其余候选保持未提交

#### Scenario: 非图片素材不入候选

- **WHEN** 画布上有一张视频素材卡与一张音频素材卡
- **THEN** 两者都不出现在转场候选池里

### Requirement: 转场候选参考池投影

转场输入读取工具 MUST 返回候选池投影：每项含 `token`、`label`、来源（角色/素材/手工 URL）、`url` 与是否已提交；冲突或不可用候选 MUST 带原因。已提交 0 项时 MUST 仍返回完整候选与一句候选/已提交计数摘要。

#### Scenario: 空提交仍有候选

- **WHEN** 接缝有 5 个候选但 `refIds` 为空
- **THEN** 工具返回 5 条候选、全部标为未提交，并给出"候选 5 项、已提交 0 项"的摘要

#### Scenario: 候选与提交同源

- **WHEN** 用户或 Agent 把某个候选写入 `refIds`
- **THEN** 同一次读取里该候选标为已提交，且出现在有序 `refs` 列表中

### Requirement: Agent 写入转场参考

系统 MUST 提供按名字寻址的转场参考写入工具：接受源镜号与可选目标镜号、参考类型（角色/素材/URL）和名字列表，`add` 为幂等并集，`remove` 只移除目标项。名字找不到或有歧义时 MUST 报错并列出候选，MUST NOT 写入任何猜测的 token；工具 MUST NOT 修改参考以外的字段。

#### Scenario: 按角色名添加

- **WHEN** Agent 对某接缝 add 角色「林澈」
- **THEN** 该角色外观 token 进入 `refIds`，返回按提交顺序编号的参考列表

#### Scenario: 移除只减目标项

- **WHEN** 已有三张参考，Agent remove 其中一张素材
- **THEN** 另外两张保持不变，被移除项不再出现在提交列表

#### Scenario: 名字歧义不写入

- **WHEN** 存在两张同名素材卡而 Agent 只给了标题
- **THEN** 返回 `ok: false` 并列出候选，`refIds` 保持原值

### Requirement: Agent 开关转场原生音频

系统 MUST 提供转场原生音频写入工具：只接受开关与角色名，音色 MUST 由系统按该角色的音色样本解析，MUST NOT 接受调用方传入的音频地址。角色没有可用样本、样本已失效、台词缺失或多说话人时 MUST 返回可读原因且 MUST NOT 写入配置。

#### Scenario: 开启并解析音色

- **WHEN** Agent 为某接缝开启原生音频并指定唯一说话角色，该角色有有效样本
- **THEN** 转场写入 `audioMode: native` 与解析出的音色引用，投影显示音频 1 的标签与角色

#### Scenario: 样本缺失则拒绝

- **WHEN** 指定角色没有音色样本
- **THEN** 返回 `ok: false` 与"去角色卡生成音色样本"的可执行提示，`audioMode` 保持原值

#### Scenario: 多说话人则拒绝

- **WHEN** 接缝两镜台词来自两个不同角色
- **THEN** 返回多说话人原因，不写入原生音频

#### Scenario: 关闭音频

- **WHEN** Agent 把模式设为 off
- **THEN** `audioMode` 变为 `off` 且音色引用与音频元数据被清空

### Requirement: 转场出片区参考素材可见

转场生成区 MUST 让用户在不展开折叠面板时也能看到本次提交了哪些参考素材：每条至少给出 `[图N]` 序号、缩略图、名称与来源标签（角色/素材/手工 URL）。由 Agent 写入的参考 MUST 带可识别的来源标记。

#### Scenario: 缩略图条可见

- **WHEN** 转场提交了三张参考图
- **THEN** 出片区显示三张缩略图，序号与提示词中的 `[图N]` 一致

#### Scenario: Agent 写入有标记

- **WHEN** 参考由本轮 Agent 工具写入
- **THEN** 对应条目显示 Agent 来源标记，用户可据此核对

#### Scenario: 零参考也有结论

- **WHEN** 转场没有任何风格参考
- **THEN** 出片区明确显示"无参考图"，而不是留一块空白
