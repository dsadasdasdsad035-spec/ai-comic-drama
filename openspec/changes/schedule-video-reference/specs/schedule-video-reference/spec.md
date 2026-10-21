# Spec Delta

## Purpose

让画布生成的 3D 调度视频可以直接作为 Seedance 出片的视频参考，用整段运镜与走位约束生成，而不是抽关键帧当参考图。

## ADDED Requirements

### Requirement: 视频参考是显式且受模型能力约束的模式

镜头 MUST 提供「3D 视频参考」开关，默认关闭；只有当前出片模型声明支持视频参考时才可开启。开启后系统 SHALL 使用本镜已生成的调度视频作为 `reference_video`。未生成调度视频或模型不支持时 MUST 返回可读错误，且 MUST NOT 静默改用抽帧或换模型。

#### Scenario: 支持的模型开启视频参考

- **WHEN** 镜头已有调度视频、当前模型支持视频参考，用户开启开关并出片
- **THEN** 请求进入视频参考模式，并带上该调度视频

#### Scenario: 默认关闭

- **WHEN** 用户未开启视频参考开关
- **THEN** 请求与现有首帧 / 多图参考通路一致，不包含任何视频参考

#### Scenario: 模型不支持

- **WHEN** 当前模型是 Seedance 1.0/1.5 且用户尝试开启视频参考
- **THEN** 系统返回 400 与明确原因，不创建远端任务，也不自动换成支持的模型

#### Scenario: 没有调度视频

- **WHEN** 镜头没有 `scheduleVideo` 且用户开启视频参考
- **THEN** 系统提示先生成 3D 调度视频，不提交任务

### Requirement: 本地调度视频通过方舟文件接口换取可访问地址

系统 SHALL 使用当前视频渠道的 Bearer Key，把本地调度视频以 `purpose=user_data` 上传到方舟 Files API，轮询文件状态到 `active`，并把返回的预签名 `download_url` 用作视频参考的 `video_url`。上传或轮询失败时 MUST 让本次出片失败并给出可读原因，MUST NOT 退回抽帧或换模型。

#### Scenario: 上传并取得地址

- **WHEN** 用户开启视频参考并出片
- **THEN** 系统上传本地 mp4，轮询到 `active`，请求体中的 `video_url.url` 是 Files API 返回的 `download_url`

#### Scenario: 上传或处理失败

- **WHEN** Files API 上传失败、文件进入 `failed` 或轮询超时
- **THEN** 本次出片标记失败，错误信息说明是调度视频上传阶段，不提交视频生成任务

#### Scenario: 相同文件复用

- **WHEN** 同一路径、大小与 mtime 的调度视频在缓存有效期内再次出片
- **THEN** 系统复用已有文件 ID，按需刷新下载地址，不重复上传

#### Scenario: 文件过期

- **WHEN** 缓存的方舟文件已过期或查询返回不可用
- **THEN** 系统重新上传并更新缓存

### Requirement: 视频参考与首帧/尾帧模式互斥

视频参考开启时，系统 MUST NOT 在同一个请求里发送 `first_frame`、`last_frame` 或 `camera_fixed`；图片只能以 `reference_image` 出现。界面 MUST 禁用「以下一镜画面作尾帧约束」并说明本镜不再有首帧/尾帧硬锁。系统 MAY 继续请求 `return_last_frame`，供下一镜接龙。

#### Scenario: 请求体不含首尾帧

- **WHEN** 视频参考开启
- **THEN** `content` 只包含文本、`reference_image` 与 `reference_video`，没有 `first_frame`、`last_frame`、`camera_fixed`

#### Scenario: 尾帧约束被禁用

- **WHEN** 视频参考开启且下一镜已有画面
- **THEN** 尾帧约束选项不可用，并显示互斥原因

#### Scenario: 仍返回尾帧

- **WHEN** 视频参考任务成功
- **THEN** 系统按 `return_last_frame` 返回尾帧，下一镜仍可把该尾帧当首帧

### Requirement: 参考视频请求体与提示词指向明确

系统 SHALL 以 `{ type: "video_url", video_url: { url }, role: "reference_video" }` 传入调度视频，并在提示词中用 `@视频1` 指代它；提示词 MUST 限定只参考机位运动、人物走位与相对位置，不照搬白模、网格、几何体材质与文字标签。参考图 MUST 使用 `reference_image` 角色。Seedance 2.5 MUST 显式设置 `omni_reference_task_type=reference`。

#### Scenario: 请求体结构

- **WHEN** 视频参考出片
- **THEN** `content` 含一个 `video_url` 且 `role` 为 `reference_video`，图片项 `role` 为 `reference_image`

#### Scenario: 提示词范围

- **WHEN** 系统组装提示词
- **THEN** 提示词含 `@视频1`，并明确排除白模、网格、几何体材质与文字标签

#### Scenario: 2.5 任务类型

- **WHEN** 当前模型属于 Seedance 2.5
- **THEN** 请求体带 `omni_reference_task_type: "reference"`，避免被判定为视频编辑或延长

#### Scenario: 2.0 不传任务类型

- **WHEN** 当前模型属于 Seedance 2.0 系列
- **THEN** 请求体不传 `omni_reference_task_type`

### Requirement: 显式模型键在视频族内精确解析

系统 SHALL 在 `video` 与 `videoRef` 两个能力族内按显式 `modelKey` 精确查找；找到即使用该模型，找不到 MUST 返回 400，不得回退到另一模型。视频参考能力 MUST 由模型条目声明，系统 MUST NOT 仅凭模型 ID 猜测。

#### Scenario: 选中 2.0 模型

- **WHEN** 用户显式选择 Seedance 2.0 模型并开启视频参考
- **THEN** 请求使用该模型的 ID，而不是 `videoRef` 默认的 1.0 模型

#### Scenario: 显式键不存在

- **WHEN** `modelKey` 在 `video` 与 `videoRef` 中都不存在
- **THEN** 返回 400 `model-key-not-found`，不提交任务

#### Scenario: 未声明视频参考能力

- **WHEN** 模型条目没有视频参考能力标记
- **THEN** 视频参考开关不可用，提交时返回明确错误

### Requirement: 现有出片通路与项目数据保持兼容

视频参考关闭时，现有首帧、尾帧、多图参考与调度关键帧通路 MUST 保持原有行为，1.0 模型继续可用。`use_schedule_video_ref` SHALL 随镜头写入 `project.json`，缺省为 false；临时 `download_url` 与方舟文件 ID MUST NOT 写入项目文件。

#### Scenario: 1.0 默认出片

- **WHEN** 未开启视频参考并使用 Seedance 1.0
- **THEN** 请求与改动前一致，不包含 `video_url`

#### Scenario: 项目保存与恢复

- **WHEN** 镜头开启视频参考并保存项目，之后重新打开
- **THEN** 开关状态恢复，`schedule_video` 仍指向本地路径，项目文件中没有临时下载地址

#### Scenario: 旧项目

- **WHEN** 读取没有 `use_schedule_video_ref` 的旧项目
- **THEN** 按关闭处理，不报错、不需要迁移
