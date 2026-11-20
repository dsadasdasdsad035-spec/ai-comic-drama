# Spec Delta

## ADDED Requirements

### Requirement: 视口点选用户对象

系统 SHALL 允许用户在三维视口中点选由工作台管理的对象（立板或 GLB）；点选后 MUST 在侧栏对象列表中高亮对应项。点选空地时 MUST 清除当前选择。

#### Scenario: 点选立板

- **WHEN** 用户在工作台视口点击一个已加载的立板网格
- **THEN** 侧栏中对应 `objects[]` 条目为选中态

#### Scenario: 从列表选中

- **WHEN** 用户在侧栏点击某对象条目
- **THEN** 视口内该对象为当前 Gizmo 作用目标

### Requirement: Gizmo 变换并持久化

系统 SHALL 对当前选中的用户对象提供平移、旋转、缩放 Gizmo；用户结束拖拽后 MUST 将结果写入该对象在 `material3dScenes` 中的 `transform`，并在合理防抖或立即保存策略下通过 `patchProject` 落库。

#### Scenario: 平移后刷新

- **WHEN** 用户用 Gizmo 平移对象并保存完成
- **THEN** 刷新页面后该对象 `transform.position` 与保存前一致（允许浮点误差）

#### Scenario: 无选中对象

- **WHEN** 当前无选中对象
- **THEN** 系统 MUST NOT 显示对象 Gizmo（或 Gizmo 处于无附着状态）

### Requirement: 嵌入式检视属性面板

系统 SHALL 在工作台提供可选「检视器」区域，通过懒加载方式嵌入 Babylon Inspector 属性网格；默认配置 MUST 为嵌入模式且 `showExplorer: false`、`showInspector: true`。未进入工作台或未开启检视器时 MUST NOT 加载 Inspector 包。

#### Scenario: 打开检视器

- **WHEN** 用户展开或进入含检视器的工作台布局
- **THEN** 属性区域可对应当前选中场景的节点显示可编辑属性（与 Inspector 能力一致）

#### Scenario: 选中对象联动

- **WHEN** 用户在视口或列表选中某对象
- **THEN** 检视器 MUST 展示该对象的属性（或等效调用 Inspector 的 select API）

### Requirement: 产品文案不使用 Babylon Editor 名称

系统 MUST NOT 在素材场景三维相关 UI、提示或 README 段落中将本功能称为「Babylon Editor」；应使用「场景三维」「检视器」等中文产品用语。

#### Scenario: 工作台顶栏

- **WHEN** 用户打开场景三维工作台
- **THEN** 可见文案不得包含字符串「Babylon Editor」