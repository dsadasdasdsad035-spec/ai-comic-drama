# Spec Delta

## ADDED Requirements

### Requirement: 转场画布参考连线

当转场接缝为 `transition` 且 `mode=generated` 时，系统 MUST 允许用户从画布角色卡或图片素材卡建立**仅作用于该转场**的参考关系，持久化为源镜头 `transitionOut.generated.refIds`（token 与分镜参考同源：`char-*`、`asset-*` 等）。用户 MUST 能通过（1）先选中转场边再从素材/角色连到该边上/下镜端点，或（2）选中转场边后右键素材/角色点选参考，完成增删。系统 MUST 绘制可选择的派生参考边（与分镜参考边区分标签，如「转场参考」），删除该边或键盘删除 MUST 从 `generated.refIds` 移除对应 token。转场画布参考 MUST NOT 写入任一镜头的 `refIds`。

#### Scenario: 拖线建立转场参考

- **WHEN** 用户选中转场边且接缝为生成模式，从素材卡拖到该转场的上镜或下镜节点
- **THEN** 素材 token 写入 `generated.refIds`，画布出现「转场参考」派生边，出片预览列出该图且单镜 refIds 不变

#### Scenario: 未选边仍走分镜逻辑

- **WHEN** 用户未选中转场边，从素材连到某分镜
- **THEN** 仅更新该分镜 `refIds`，不修改任何 `generated.refIds`

#### Scenario: 删除转场参考边

- **WHEN** 用户选中转场参考派生边并删除
- **THEN** 对应 token 从 `generated.refIds` 移除，预览参考计数更新

#### Scenario: 效果模式拒绝

- **WHEN** 转场接缝仍为效果模式，用户尝试建立转场画布参考
- **THEN** 系统提示须先设为「生成」，且不写入 refIds

## MODIFIED Requirements

### Requirement: 风格参考可继承、排除与增补

系统 SHALL 默认继承相邻两镜已通过连线解析的角色与图片素材参考；用户 MUST 能关闭继承、逐项排除继承项，并从画布连线或面板增补**仅属于该转场**的 token（`generated.refIds`）。增补与排除 MUST 持久化在转场 `generated` 配置中，刷新与重开项目后保留。画布增补与面板增补 MUST 使用同一 token 集合并反映在出片预览与请求中。

#### Scenario: 排除继承项

- **WHEN** 用户对某条继承自上镜的参考点击排除
- **THEN** 该参考不再出现在将提交列表，`excludeRefIds` 含其 token

#### Scenario: 增补素材

- **WHEN** 用户从候选列表添加一张未连线的场景图
- **THEN** 该参考出现在风格参考列表并持久化 token

#### Scenario: 画布增补素材

- **WHEN** 用户通过转场画布参考连线加入一张未在两镜 refIds 中的场景图
- **THEN** 该参考出现在统一参考列表，`generated.refIds` 含其 asset token，且 `buildTransitionVideoRequest` 在策略允许时包含对应 URL

#### Scenario: 面板增补与画布等价

- **WHEN** 用户曾在面板「补充参考」添加的 token 与画布连线添加的 token 相同
- **THEN** 二者不重复计数，预览只列一条

## REMOVED Requirements

（无）
