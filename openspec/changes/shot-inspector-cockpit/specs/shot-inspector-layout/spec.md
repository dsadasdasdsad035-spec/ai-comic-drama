# Spec Delta

## Purpose

把画布分镜的右侧 Inspector 组织成按意图分页的镜头驾驶舱，让用户快速看到这一镜的状态、定位到要改的内容，并始终能触发生成动作。

## ADDED Requirements

### Requirement: 分镜 Inspector 分为四个意图页

分镜 Inspector SHALL 提供 `画面`、`视频`、`声音`、`更多` 四个 tab，同一时间 MUST 只有一个 tab 处于激活状态。`画面` 放镜头参数、当前画面、画面提示词、参考、出图设置和构图标注；`视频` 放当前视频、运动提示词、出片提示词、3D 调度、原生音频和出片设置；`声音` 放台词/音效、表演、配音和口型；`更多` 放低频与高级项。

#### Scenario: 四个 tab 存在
- **WHEN** 用户选中一个分镜镜头
- **THEN** Inspector 顶部显示四个 tab，且只有一个带激活状态

#### Scenario: 生成相关控件在对应页
- **WHEN** 用户在 `画面` tab 查找生成画面、在 `视频` tab 查找生成视频
- **THEN** 对应按钮和设置都在该页内，不需要跨页查找

### Requirement: 默认页和状态入口

Inspector SHALL 在用户首次选中镜头时按镜头状态选择默认 tab：已有当前画面时进入 `视频`，没有当前画面时进入 `画面`。用户手动切换后 MUST 记住该 tab；头部 MUST 提供 `画面`、`视频`、`配音`、`提示词` 状态 chip，点击 chip MUST 切到对应 tab。

#### Scenario: 已有画面
- **WHEN** 用户选中一个已经有当前画面的镜头
- **THEN** `视频` tab 激活，出片提示词面板直接可见

#### Scenario: 尚无画面
- **WHEN** 用户选中一个还没有当前画面的镜头
- **THEN** `画面` tab 激活，头部提示词 chip 显示当前状态并可一键切到 `视频`

#### Scenario: 记住选择
- **WHEN** 用户切到 `声音` tab 后再选中另一个镜头
- **THEN** Inspector 仍停留在 `声音` tab

### Requirement: 固定的镜头头部

Inspector 顶部 SHALL 固定显示镜头缩略图或占位、镜号、稳定 ID 和媒体状态 chip，滚动内容时头部 MUST 保持可见。删除等危险或低频操作 MUST 收进右上角溢出菜单，并要求二次确认。

#### Scenario: 滚动时头部可见
- **WHEN** 用户在 `视频` tab 向下滚动到出片设置
- **THEN** 镜号、状态 chip 和溢出菜单仍然可见

#### Scenario: 删除需要确认
- **WHEN** 用户从溢出菜单选择删除
- **THEN** 系统要求二次确认，确认后才删除镜头

### Requirement: 固定的主操作栏

Inspector 底部 SHALL 固定显示当前 tab 的主操作和预估费用：`画面` 为生成画面，`视频` 为生成视频，`声音` 为生成配音。操作栏 MUST 在滚动时保持可见；运行中 MUST 显示运行状态并阻止重复提交，已有取消能力的操作 MUST 提供取消入口；不可执行时必须显示原因。

#### Scenario: 滚动后仍能生成
- **WHEN** 用户在 `画面` tab 顶部修改提示词后向下滚动
- **THEN** 生成画面按钮和费用仍在底部可见，不需要滚回顶部

#### Scenario: 运行中状态
- **WHEN** 当前 tab 的生成任务正在运行
- **THEN** 底部主操作显示运行状态并不可重复提交；图片生成仍可从操作栏取消

### Requirement: 面板宽度可调

Inspector SHALL 允许通过左侧拖拽把手把宽度调整到 320–520px，默认 360px；双击把手 MUST 复位到默认宽度。宽度 MUST 被持久化，并在下次打开时恢复；到达上下限时 MUST 停止继续缩放且不遮挡画布关键操作。

#### Scenario: 拖宽
- **WHEN** 用户把 Inspector 从 360px 拖到 480px
- **THEN** 面板变宽、内容重新排版，画布仍可正常平移和选中

#### Scenario: 宽度恢复
- **WHEN** 用户刷新页面或重新打开项目
- **THEN** Inspector 使用上次保存的宽度

### Requirement: 长区块可折叠

Inspector SHALL 允许折叠镜头参数、表演、3D 调度、参考和高级区块；折叠后 MUST 保留一行摘要，折叠状态 MUST 持久化。默认状态 MUST 为：镜头参数折叠、表演折叠、3D 调度折叠、参考展开、高级折叠。

#### Scenario: 折叠表演
- **WHEN** 用户折叠多人镜头的表演区
- **THEN** 该区只显示角色和情绪的摘要行，后续配音与口型区上移

#### Scenario: 记住折叠状态
- **WHEN** 用户展开 3D 调度后刷新页面
- **THEN** 该区块保持展开

### Requirement: 参考信息集中且不重复

`画面` tab SHALL 集中展示当前镜头实际使用的角色、场景、道具和手工参考，并标注视频出片最多 4 张的限制与省略状态；`更多` tab MAY 保留手工参考 URL 输入。Inspector MUST NOT 在不同 tab 重复展示同一组参考的完整编辑控件。

#### Scenario: 参考集中
- **WHEN** 镜头连了角色、场景和道具
- **THEN** `画面` tab 用带身份的缩略项列出它们，并显示视频出片实际使用/省略数量

#### Scenario: 手工 URL
- **WHEN** 用户需要粘贴手工参考 URL
- **THEN** 入口在 `更多` tab，保存后仍出现在 `画面` 的参考汇总中

### Requirement: 切换 tab 不丢失编辑状态

切换 tab MUST NOT 丢失正在编辑的提示词草稿、表演输入或表单状态。非活动 tab MAY 从视觉和辅助技术中隐藏，但其已输入内容 MUST 保留；只有活动 tab 的图片、视频或音频预览可以播放。

#### Scenario: 切换 tab 保留草稿
- **WHEN** 用户在 `视频` tab 编辑出片提示词但未保存，然后切到 `声音`
- **THEN** 切回 `视频` 时草稿仍在

#### Scenario: 隐藏媒体不播放
- **WHEN** 用户离开 `视频` tab
- **THEN** 当前视频预览停止播放，音频预览不在后台继续出声

### Requirement: 问题只出现一次并靠近操作

每个可修复问题 MUST 在 Inspector 中只出现一次，并显示在相关区块或主操作附近。系统 MUST NOT 重复渲染同一句警告，例如配音超过镜头时长的提示。

#### Scenario: 配音超时只提示一次
- **WHEN** 配音时长超过镜头时长
- **THEN** 只出现一条超时警告，且位于配音或主操作附近

### Requirement: 素材卡 Inspector 保持原样

本次驾驶舱布局 MUST 只作用于分镜镜头；角色卡和素材卡 Inspector MUST 保持现有结构和行为，不出现分镜 tab、状态 chip 或吸底生成操作。

#### Scenario: 选中素材卡
- **WHEN** 用户选中一个素材卡
- **THEN** 右侧显示原有素材面板，不显示分镜驾驶舱

### Requirement: 无障碍与键盘可用

tab 列表 MUST 使用可识别的 tab/tablist 语义并暴露激活状态，折叠区 MUST 可用键盘展开/收起，吸底操作栏按钮 MUST 有可读标签和焦点样式。

#### Scenario: 键盘切换
- **WHEN** 键盘焦点进入 tab 列表并按方向键或 Tab
- **THEN** 焦点在 tab 间移动，Enter/Space 能激活对应 tab

### Requirement: 不改变生成行为与数据

本次布局调整 MUST NOT 改变生成画面、生成视频、配音、口型、3D 调度或提示词拼装的行为；MUST NOT 新增或修改 `ShotData` / `ProjectShot` 字段和 API。除宽度、tab 和折叠偏好外，Inspector 的修改 MUST 继续按现有 patch 链路保存。

#### Scenario: 生成请求不变
- **WHEN** 同一镜头在旧版和新版 Inspector 中点击生成视频
- **THEN** 提交的请求字段和提示词正文相同

#### Scenario: 字段保存不变
- **WHEN** 用户在新布局中修改画面提示词或运动提示词
- **THEN** 数据仍写入原有镜头字段，刷新后保留
