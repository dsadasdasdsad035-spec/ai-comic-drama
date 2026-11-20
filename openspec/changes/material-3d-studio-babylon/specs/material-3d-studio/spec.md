# Spec Delta

## Purpose

让用户在素材页用浏览器三维视口编排场景/道具参考与 GLB 模型，保存机位书签供分镜与后续流程引用，而不承担 Blender 成片渲染职责。

## ADDED Requirements

### Requirement: 素材页提供场景三维入口

系统 SHALL 在素材页提供与角色/场景/道具/视频/镜头语言并列的「场景三维」入口；未选择项目时 MUST 禁用创建与编辑并提示先选项目。

#### Scenario: 已选项目进入 Tab

- **WHEN** 用户已选项目并点击「场景三维」
- **THEN** 系统展示该项目的三维场景列表（可为空）与进入工作台的控件

#### Scenario: 未选项目

- **WHEN** 用户未选项目并进入「场景三维」
- **THEN** 系统 MUST NOT 允许保存三维数据，并提示先选择项目

### Requirement: 三维场景按项目持久化

系统 SHALL 在 `ProjectData` 中按项目保存 `material3dScenes` 数组；每项 MUST 包含稳定 `id`、显示名称、对象列表与机位书签列表。切换项目 MUST 只加载目标项目数据，MUST NOT 与其他项目混用。

#### Scenario: 保存后刷新仍在

- **WHEN** 用户在工作台修改场景并保存
- **THEN** 刷新页面或重新打开项目后 MUST 恢复相同对象与机位书签

### Requirement: 从设定卡创建立板对象

系统 SHALL 允许用户从当前项目的场景或道具设定卡（存在当前图且路径可解析）在工作台中创建立板对象；立板 MUST 使用该项目内图片 URL，MUST NOT 引用项目外地址。

#### Scenario: 有图场景卡立板

- **WHEN** 用户从一张有当前图的场景设定卡添加到三维场景
- **THEN** 视口中出现对应该图的立板，且保存后再次打开仍存在

#### Scenario: 无图或缺失文件

- **WHEN** 设定卡无当前图或图片被标记缺失
- **THEN** 系统 MUST 拒绝创建立板并说明原因

### Requirement: 从项目资产导入 GLB 或 glTF

系统 SHALL 允许用户从 `project.assets` 中选择扩展名为 `.glb` 或 `.gltf` 的条目导入为网格对象；URL MUST 为项目内 `/project-assets/...` 路径。

#### Scenario: 成功导入

- **WHEN** 用户选择有效的项目内 GLB 资产并确认导入
- **THEN** 网格出现在视口中且保存后持久化

#### Scenario: 非模型资产

- **WHEN** 用户尝试导入非 glTF 类资产
- **THEN** 系统 MUST 拒绝并说明仅支持 GLB/glTF

### Requirement: 机位书签

系统 SHALL 允许用户在当前三维场景中保存、命名、恢复与删除机位书签；每条书签 MUST 记录足以恢复 Arc 相机视点的参数（如 alpha、beta、radius、target）。

#### Scenario: 保存并恢复机位

- **WHEN** 用户调整视点后保存机位书签并稍后从列表恢复
- **THEN** 相机 MUST 回到与保存时一致的视点（允许数值浮点误差）

### Requirement: 视口截图落盘为项目素材

系统 SHALL 可选地将当前视口捕获为 PNG 写入项目资产目录并在 `project.assets` 登记；MUST NOT 自动发布到画布素材卡。

#### Scenario: 导出截图

- **WHEN** 用户触发视口截图导出
- **THEN** 生成项目内 PNG 路径并在资产列表中可见，画布上无新卡 unless 用户另行发布

### Requirement: 三维引擎按需加载

系统 SHALL 仅在用户进入场景三维相关界面时加载浏览器三维引擎依赖；进入角色/场景/道具等其它素材 Tab 时 MUST NOT 因本能力拉取该引擎包。

#### Scenario: 未进入场景三维

- **WHEN** 用户只浏览素材页角色 Tab
- **THEN** 首屏网络请求 MUST NOT 包含本变更新增的三维引擎主包（以构建产物分包为准）

### Requirement: 与 Blender 成片分工

系统 MUST NOT 在场景三维工作台内调用 Blender 渲染宿主出 MP4，MUST NOT 将三维场景数据自动写入 `SceneCode` 或白模代码字段。

#### Scenario: 用户寻求成片

- **WHEN** 用户在场景三维内查找「渲染视频」类成片动作
- **THEN** 系统不提供浏览器成片；界面文案 MUST 指向创意 Blender 三维专家或既有白模路径