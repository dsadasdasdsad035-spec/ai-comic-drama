# Spec Delta

## MODIFIED Requirements

### Requirement: 每镜持久化生产类型

系统 SHALL 为每个留在分镜序列中的镜头保存出片工位，取值为 `video`。新建与插入 MUST 写入 `video`。系统 MUST NOT 新建 `image` 工位的镜头。项目加载完成本变更的迁移后，序列中 MUST NOT 再保留 `image` 工位的镜头。

#### Scenario: 新建生图镜

- **WHEN** 用户在画布新增镜头
- **THEN** 系统不创建生图镜，新镜头工位为出片并写入项目

#### Scenario: 新建出片镜

- **WHEN** 用户在画布新增镜头并确认
- **THEN** 新镜头工位为出片并写入项目

#### Scenario: 重开项目保留类型

- **WHEN** 用户保存项目后重新打开，且迁移已经完成
- **THEN** 序列中的镜头都是出片镜

### Requirement: 生产类型互斥主路径

每个镜头 MUST 提供视频出片主路径，MUST NOT 提供静帧生成主操作，包括生成画面、画面页和对该镜的批量出图。镜头上的静帧预览 MUST NOT 开通静帧主生成。

#### Scenario: 生图卡可出图不可主出片

- **WHEN** 用户对任意镜头请求生成画面
- **THEN** 系统不提交静帧生成，也不显示生成画面主操作

#### Scenario: 出片卡可出片不可主出图

- **WHEN** 用户选中镜头且出片条件满足
- **THEN** Inspector 提供生成视频主操作，且不出现生成画面主操作

#### Scenario: 批量队列尊重类型

- **WHEN** 用户对当前集镜头触发批量出图
- **THEN** 没有镜头进入静帧队列

### Requirement: Inspector Tab 由当前镜类型决定

分镜 Inspector MUST NOT 显示生图工位的「画面」或「叙事」页面，MUST NOT 提供「生成画面」主操作。系统 MUST NOT 用画布级开关把镜头改成生图。出片镜的页面结构由出片布局规格决定。

#### Scenario: 选中生图卡

- **WHEN** 用户查看镜头 Inspector
- **THEN** 不存在生图卡，也不出现「画面」「叙事」出图页面

#### Scenario: 选中出片卡

- **WHEN** 用户选中序列中的镜头
- **THEN** Inspector 不出现生成画面主操作

#### Scenario: 切换选中镜即切换 Tab 集合

- **WHEN** 用户从一镜改选到另一镜
- **THEN** 两镜都不出现生图页面或工位切换控件

### Requirement: 遗留镜头水合规则

项目加载时，缺少工位字段且未被迁移拆出的镜头 MUST 按出片镜用于界面，无论是否带有静帧。`prod_kind` 明确为 `image` 的镜头 MUST 先按素材卡迁移处理，MUST NOT 再作为生图镜进入序列。

#### Scenario: 仅静帧遗留

- **WHEN** 旧镜头有静帧，没有成片，也没有写明工位
- **THEN** 水合为出片镜，静帧保留在镜上

#### Scenario: 双轨遗留为出片卡

- **WHEN** 旧镜头同时有静帧与成片
- **THEN** 水合为出片镜

#### Scenario: 仅出片遗留

- **WHEN** 旧镜头有成片且无静帧
- **THEN** 水合为出片镜

#### Scenario: 标明生图的镜头不水合进序列

- **WHEN** 镜头的 `prod_kind` 明确为 `image`
- **THEN** 它不作为生图镜出现在序列中

## REMOVED Requirements

### Requirement: 定帧到动镜不复用同卡双主路径

**Reason**: 出图不再发生在镜头上，同一张卡不会同时承担静帧和出片。

**Migration**: 在图片素材卡上出图，再把该卡连到出片镜作为图片参考。
