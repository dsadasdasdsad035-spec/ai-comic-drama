# Spec Delta

## MODIFIED Requirements

### Requirement: 工位徽章与过滤状态 chip

分镜 Inspector 头部 MUST NOT 把镜头标成生图镜，MUST NOT 提供切换到生图的入口。状态 chip MUST NOT 展示「生成画面」引导。

#### Scenario: 生图镜 chip

- **WHEN** 用户查看镜头 Inspector
- **THEN** 头部不显示生图镜徽章，也没有改成生图镜的操作

#### Scenario: 出片镜 chip

- **WHEN** 用户选中序列中的镜头
- **THEN** 状态 chip 不含生成画面引导

## REMOVED Requirements

### Requirement: 镜头类型在溢出菜单

**Reason**: 镜头不再有生图和出片两种工位，溢出菜单里的类型切换没有目标。

**Migration**: 去掉该控件。需要出图时新建图片素材卡。

### Requirement: 生图参考文案不含出片指令

**Reason**: 镜头上不再有生图「画面」页，这条文案失去载体。

**Migration**: 参考图说明改到图片素材卡的出图区域。
