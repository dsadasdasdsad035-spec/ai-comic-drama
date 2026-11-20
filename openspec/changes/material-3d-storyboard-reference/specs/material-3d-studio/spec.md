# Spec Delta

## ADDED Requirements

### Requirement: 变换数字面板与 Gizmo 一致落库

系统 SHALL 在工作台「层级」视图为当前选中对象提供位置、旋转、缩放的数字编辑；用户修改后 MUST 将结果写入该对象在 `material3dScenes` 中的 `transform`，并与 Gizmo 拖拽使用同一真相源。刷新页面后数值 MUST 与保存前一致（允许浮点误差）。

#### Scenario: 数字改位置后刷新

- **WHEN** 用户在变换面板将某对象 X 坐标改为指定值并触发保存
- **THEN** 刷新后该对象 `transform.position.x` 与指定值一致

#### Scenario: Gizmo 与面板同步

- **WHEN** 用户用 Gizmo 平移对象
- **THEN** 变换面板中对应坐标 MUST 更新为与 Gizmo 一致（允许浮点误差）

### Requirement: 对象分镜元数据

系统 SHALL 支持为场景对象设置可选 `label` 与 `locked`。`label` MUST 在侧栏对象列表中优先于技术 id 显示。`locked` 为 true 时对象 MUST NOT 被视口点选附着 Gizmo，且 SHOULD 在列表中可见锁定态。

#### Scenario: 锁定对象不可拖拽

- **WHEN** 用户将某对象设为锁定
- **THEN** 视口点选该对象 MUST NOT 显示 Gizmo

### Requirement: 立板尺寸可配置

系统 SHALL 允许立板对象可选 `billboardSize`（宽、高）；未设置时 MUST 使用与当前实现一致的默认尺寸。保存后刷新 MUST 恢复相同平面比例。

#### Scenario: 修改立板宽度

- **WHEN** 用户为选中立板设置宽度与高度并保存
- **THEN** 刷新后视口中立板宽高比与保存值一致

### Requirement: 场景预览环境持久化

系统 SHALL 允许每个三维场景保存可选 `environment`（至少背景色、地面可见性与尺寸、环境光与主光强度倍率）。用户修改后 MUST 写入 `material3dScenes` 并在重新打开工作台时应用于视口预览。

#### Scenario: 修改背景色

- **WHEN** 用户在「场景」设置中修改背景色并离开工作台
- **THEN** 再次打开同一场景时视口背景 MUST 为新颜色

### Requirement: 机位 Markdown 导出

系统 SHALL 在机位区域提供将当前场景机位书签与对象摘要复制为 Markdown 文本的操作（剪贴板）。内容 MUST 包含场景名称、每条机位的标签与轨道参数、以及对象列表的可读摘要。

#### Scenario: 复制机位说明

- **WHEN** 用户点击「复制机位说明」且场景至少有一个机位书签
- **THEN** 系统 MUST 将非空 Markdown 写入剪贴板且包含机位标签

### Requirement: 机位 JSON 导出

系统 SHALL 提供下载当前场景分镜参考 JSON 的操作。文件 MUST 包含 `schemaVersion`、`purpose` 值为 `storyboard-reference`、`cameras` 数组及对象摘要字段。

#### Scenario: 下载 JSON

- **WHEN** 用户点击「导出 JSON」
- **THEN** 浏览器 MUST 下载一个 JSON 文件且 `cameras` 与项目中该机位书签一致

### Requirement: 检视器不保存提示

系统 MUST 在嵌入式检视器区域向用户说明：检视器内修改不属于项目数据，刷新或同步场景后会丢失。

#### Scenario: 展开检视器

- **WHEN** 用户展开检视器
- **THEN** 可见文案 MUST 包含「不保存」或等效中文说明