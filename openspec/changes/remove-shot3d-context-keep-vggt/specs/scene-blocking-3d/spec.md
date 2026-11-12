# Spec Delta

## ADDED Requirements

### Requirement: VGGT 分析仅允许调度片与会话摄取视频

3D 工作台内的参考片几何分析（VGGT）MUST 仅从以下来源选择 `videoRef`：（1）当前镜已保存或本会话渲染的调度片（只读，标注非调度真相）；（2）本会话内在 VGGT 区通过平台链接或上传摄取、落盘为 `/project-assets/` 的 MP4。系统 MUST NOT 提供素材选择器或 `Shot3DContext` 列表作为 VGGT 视频源；MUST NOT 要求用户先把视频加入镜头级参考才能分析。

#### Scenario: 分析调度片

- **WHEN** 用户选择「当前调度片（只读）」并提交分析
- **THEN** 使用 `schedule_video` 创建 VGGT 作业，不修改调度字段

#### Scenario: 分析摄取片

- **WHEN** 用户摄取成功并在下拉选中该 URL
- **THEN** 可提交 VGGT 作业；摄取 URL 未写入 `shot_3d_context`

#### Scenario: 无素材选择器

- **WHEN** 用户在 VGGT 面板查找视频来源
- **THEN** 不出现「从素材库选择」或等价入口

### Requirement: VGGT 区平台链接与本地上传摄取

工作台 VGGT 区域 SHALL 提供平台链接与本地上传，调用与创意室相同配置的 ingest 适配器，将视频写入当前项目 `assets` 并返回站内 URL。摄取 MUST NOT 修改 `sceneCode`、`schedule_video`、`scheduleMeta`、`sceneCodeMeta` 或 `shot_3d_context`。摄取成功 MAY 仅将 URL 加入当前编辑器会话的 VGGT 下拉列表。

#### Scenario: 链接摄取成功

- **WHEN** 用户提交可解析的平台链接
- **THEN** 返回 `/project-assets/...`，VGGT 下拉可选，不触发渲染

#### Scenario: 摄取失败

- **WHEN** 摄取失败或取消
- **THEN** 调度真相与已保存镜头 JSON 不变

### Requirement: 调度新鲜度不依赖参考选择

代码调度视频的过期判定 MUST 基于代码哈希、引擎/ABI、渲染期登记的素材指纹、有效时长与画幅。系统 MUST NOT 再使用 `shot_3d_context` 或 `selectionFingerprint` 判定过期。保存镜头时 MUST NOT 写入 `shot_3d_context`；加载时 MAY 忽略文件中遗留该字段。

#### Scenario: 剥离旧 context

- **WHEN** 用户保存含 `shot_3d_context` 的旧镜头
- **THEN** 出站项目数据不含该字段

#### Scenario: 仅改遗留 context 不算过期

- **WHEN** 文件中仍有遗留 context 但代码与渲染元数据未变
- **THEN** 过期状态不因遗留字段单独变化

## MODIFIED Requirements

### Requirement: 生成失败不得覆盖有效调度

AI 生成、聊天改写或重新运行代码时，系统 MUST 保留当前有效代码与已渲染视频，直到新代码通过渲染试运行。无既有代码时 MAY 使用内置空白模板，但 MUST 标明来源。失败、超时或取消 MUST NOT 清空已有代码或视频。

#### Scenario: 重生成失败

- **WHEN** 一个已有代码的镜头重新生成时模型报错或代码渲染失败
- **THEN** 当前代码、预览和调度视频保持不变，界面显示失败原因

#### Scenario: 用户取消

- **WHEN** 用户在代码生成、试运行或渲染过程中取消
- **THEN** 已保存的数据不被改动

#### Scenario: 首次生成失败

- **WHEN** 一个还没有代码的镜头首次生成失败
- **THEN** 系统显示空白或兜底模板并标明来源，不伪装成模型生成结果

### Requirement: 编辑器保存必须限定当前项目与镜头

保存 MUST 只写入当前项目和当前镜头的代码、代码元数据与渲染元数据，并刷新该镜视频的过期状态。从 3D 调度视图打开编辑器时，保存 MUST 只写该镜的 3D 字段，MUST NOT 覆盖该镜在其它工作台未落库的镜头表提示词、描述、表演或台词草稿。取消或关闭未保存 MUST 恢复进入编辑器时的代码。保存失败 MUST 保留编辑会话并显示错误。保存 MUST NOT 写入 `shot_3d_context`。

#### Scenario: 保存成功

- **WHEN** 用户在编辑器点击保存
- **THEN** 当前镜代码与相关元数据写入当前项目，重新打开后恢复，且不包含 `shot_3d_context`

#### Scenario: 提示词草稿未保存

- **WHEN** 用户在镜头表改了该镜 `keyframe_prompt` 但还没保存，随后在 3D 调度视图打开该镜 3D 工作台并保存
- **THEN** 3D 字段写入项目，镜头表里未保存的提示词草稿保持不变

#### Scenario: 取消修改

- **WHEN** 用户修改代码后点击取消
- **THEN** 进入编辑器前的代码恢复

#### Scenario: 保存失败

- **WHEN** 保存请求失败
- **THEN** 编辑器不关闭、修改不丢失，并显示失败原因

### Requirement: 3D 调度以每镜 Blender Python 代码为场景真相

3D 调度工作台 SHALL 以每镜 Blender Python `SceneCode` 作为新镜头的场景真相；用户 MUST NOT 再通过拖拽结构化墙体、角色或固定物来编辑场景，MUST NOT 在浏览器内运行另一套 3D 场景代码。代码与渲染元数据 MUST 按镜头保存，MUST NOT 在同场其他镜头之间共享可变对象。

#### Scenario: 新镜头

- **WHEN** 用户新建或首次打开一个没有结构化数据的镜头
- **THEN** 工作台准备生成或编辑代码，不要求先建场景布局或参考勾选

#### Scenario: 代码优先

- **WHEN** 用户修改代码并保存
- **THEN** 该镜预览以代码为准，不写回 shotScene 或 shotBlocking

#### Scenario: 旧镜头

- **WHEN** 用户打开只有结构化数据的旧镜头
- **THEN** 显示只读说明和转换入口，不把旧字段当作新代码

### Requirement: 工作台采用参考内容、预览和聊天/代码三栏布局

桌面工作台 MUST 提供中间预览与时间轴、右侧聊天/代码，以及可折叠的 VGGT（参考片几何分析）区域；顶部 MUST 显示镜号、时长、画幅、代码状态和保存/渲染入口。工作台 MUST NOT 提供左侧七类「参考内容」选择器。窄屏 MUST 改为抽屉或上下堆叠，MUST NOT 出现横向溢出；MUST NOT 继续显示 SVG 平面编辑区。

#### Scenario: 桌面布局

- **WHEN** 用户在宽屏打开 3D 调度
- **THEN** 预览与聊天/代码同时可见，VGGT 可展开，无主栏参考选择器

#### Scenario: 窄屏布局

- **WHEN** 用户在窄屏打开工作台
- **THEN** VGGT 与聊天可折叠或堆叠，预览和时间轴仍可用

#### Scenario: 旧平面移除

- **WHEN** 用户打开新工作台
- **THEN** 看不到墙体/角色拖拽平面，场景修改通过代码或聊天完成

### Requirement: 聊天只修改当前镜头的 3D

编辑器 SHALL 提供聊天面板，聊天产生的代码 MUST 只作用于当前镜头，MUST NOT 自动修改上一镜、下一镜、同场其他镜头或旧结构化数据。聊天 MUST NOT 读写 `shot_3d_context`。

#### Scenario: 改当前机位

- **WHEN** 用户说“机位再远一点”
- **THEN** 只修改当前镜头代码中的相机

#### Scenario: 改当前墙体

- **WHEN** 用户说“把门挪到左边”
- **THEN** 只修改当前镜头代码中的门或墙体几何

#### Scenario: 改当前场景

- **WHEN** 用户说“把整个场景换成雨夜街道”
- **THEN** 只重写当前镜头代码，不修改其他镜头

#### Scenario: 其他镜头不变

- **WHEN** 当前镜头通过聊天改了代码
- **THEN** 上一镜和下一镜的代码与视频状态不变

### Requirement: 参考视频摄取不构成调度真相

参考视频摄取（平台链接或上传）的成功、失败或进行中，系统 MUST NOT 写入或覆盖当前镜头的 `sceneCode`、`schedule_video`、`scheduleMeta` 或等价调度字段。摄取 MUST NOT 写入 `shot_3d_context`；摄取结果仅 MAY 供当前会话 VGGT 分析使用。

#### Scenario: 摄取后不自动渲染

- **WHEN** 摄取完成
- **THEN** 不触发 `run_render`，调度视频状态不变

#### Scenario: 摄取失败保留调度

- **WHEN** 摄取失败
- **THEN** 已有代码与调度视频保持有效

### Requirement: 摄取与 VGGT 串联的界面边界

工作台 MUST 区分「下载参考视频（供 VGGT）」「几何分析（实验）」「渲染调度视频」三者的语义；摄取不得暗示已保存调度或已通过验收。

#### Scenario: 文案区分

- **WHEN** 用户完成平台下载
- **THEN** 界面不出现「已更新调度视频」类表述，仅提示可供 VGGT 分析

## REMOVED Requirements

### Requirement: 已开启的 3D 参考开关可以随时取消

**Reason**: 分镜 Inspector 与 3D 专用出片参考开关已下线，本需求无对应 UI。

**Migration**: 出片参考使用画布视频素材连线。
