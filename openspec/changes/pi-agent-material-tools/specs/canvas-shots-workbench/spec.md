# Spec Delta

## MODIFIED Requirements

### Requirement: 画布承载分镜 Agent

系统 SHALL 在画布提供分镜助手的聊天面板，使用 `shotlist` 与 `prompt` 技能，经 `submit_shots`、`submit_prompts`、`submit_joins`、`link_shot_refs` 与 `set_shot_camera_lexicon` 写回当前项目当前集。写回后 MUST 与导入走同一套落库与水合规则。线程范围 MUST 仍按项目与集。

#### Scenario: 聊天拆镜

- **WHEN** 用户在画布聊天要求拆本集
- **THEN** 草稿写回项目，画布出现本集镜头与顺序连线

#### Scenario: 只刷提示词

- **WHEN** Agent 只提交提示词更新
- **THEN** 分镜结构与画布节点不变，只更新提示词列

#### Scenario: 切集不串线程

- **WHEN** 用户在画布从一集切到另一集
- **THEN** 聊天上下文与本集镜头一起切换，其他集不被写入

#### Scenario: 聊天连参考

- **WHEN** Agent 把角色陈默连到第 3 镜
- **THEN** 该镜参考连线包含陈默，画布出现对应参考边，不新增镜头

#### Scenario: 聊天指定运镜参照

- **WHEN** Agent 把第 3 镜的运镜参照设为「推镜头」
- **THEN** 该镜运镜参照随之落库，重新打开项目后仍在

## ADDED Requirements

### Requirement: 参考连线由镜头字段唯一定义

画布上的角色与素材参考边 MUST 由目标镜的参考连线字段派生，MUST NOT 进入独立的边状态。拖线与 Agent 工具 MUST 写同一份字段，重复连接 MUST 幂等。

#### Scenario: 拖线与工具结果一致

- **WHEN** 用户拖一条角色连线到某镜，另一镜由 Agent 工具连同一角色
- **THEN** 两镜的参考字段结构一致，画布都渲染出参考边

#### Scenario: 重复连接

- **WHEN** 同一角色被连到同一镜两次
- **THEN** 该镜参考字段只有一个对应项，画布只有一条参考边

#### Scenario: 删除参考边

- **WHEN** 用户删除一条参考边
- **THEN** 该镜参考字段移除对应项，其他参考保持不变

### Requirement: Agent 参考连线按名字寻址

Agent 连接参考时 MUST 用角色名或素材标题寻址，MUST NOT 传画布节点标识。宿主 MUST 把名字解析为节点标识；解析不到时 MUST 报错并列出候选，MUST NOT 写入猜测的标识。

#### Scenario: 按角色名连接

- **WHEN** Agent 传入角色名陈默
- **THEN** 宿主解析到该角色卡并写入参考，结果回报连了几张

#### Scenario: 按素材标题连接

- **WHEN** Agent 传入素材标题「会议室全景」
- **THEN** 宿主解析到该素材卡并写入参考

#### Scenario: 名字不存在

- **WHEN** Agent 传入当前项目没有的角色名
- **THEN** 工具返回错误并列出可用角色，项目数据不被修改

#### Scenario: 标题重复

- **WHEN** 项目里有两张同名素材卡
- **THEN** 工具返回错误并列出候选标识，不替用户选其中一张

### Requirement: Agent 指定镜头运镜参照

Agent 指定运镜参照时 MUST 按条目 `key` 或中文名唯一匹配镜头语言条目。绑定 MUST 先把该条目的视频导入当前项目，再把项目内地址写入镜头；解绑 MUST 清空绑定并关闭「作为运镜参考」。MUST NOT 自动把条目发布成画布素材卡。

#### Scenario: 绑定条目

- **WHEN** Agent 为某镜指定「推镜头」
- **THEN** 该镜记录条目 key 与项目内视频地址，运镜参考开关打开

#### Scenario: 名称有歧义

- **WHEN** 给出的名字匹配到多个条目
- **THEN** 工具返回错误并列出候选条目，不写入任何绑定

#### Scenario: 解绑

- **WHEN** Agent 清除某镜的运镜参照
- **THEN** 三个绑定字段被清空，运镜参考开关关闭

#### Scenario: 不发布素材卡

- **WHEN** 绑定成功后查看画布
- **THEN** 画布节点数量不变，没有新增素材卡
