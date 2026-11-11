# Spec Delta

## Purpose

为 3D 调度工作台提供从参考视频反推相对相机运动与尺度提示的只读几何分析，辅助人工与 Agent 编写机位，不构成项目持久化数据或调度真相。

## ADDED Requirements

### Requirement: 几何分析作业异步提交与查询

系统 SHALL 提供参考视频几何分析的异步作业：客户端提交本地可访问的 mp4 路径或当前镜头上下文已选视频之一，服务端创建作业并返回 `jobId`；客户端 SHALL 通过 `jobId` 轮询作业状态直至 `completed`、`failed` 或 `cancelled`。

#### Scenario: 提交成功

- **WHEN** 用户在工作台对有效参考视频发起几何分析且 Worker 可用
- **THEN** 服务端返回 `jobId` 且作业状态为 `pending` 或 `running`

#### Scenario: Worker 未配置

- **WHEN** 未配置远程 Worker 且本机无 POC 桩
- **THEN** 提交立即以明确错误结束（HTTP 503 或等价语义），不创建长期作业目录

#### Scenario: 查询终态

- **WHEN** 客户端轮询已完成的作业
- **THEN** 响应包含 `report` 指针或内联 `report` 对象，且状态为 `completed`

### Requirement: 抽帧与探测约束

几何分析前的抽帧 SHALL 使用与创意室取证一致的 ffprobe 探测；单帧宽度 MUST 不超过 1280 像素；默认均匀采样且单作业帧数 MUST 不超过 48。

#### Scenario: 超长边缩放

- **WHEN** 源视频宽度大于 1280
- **THEN** 抽帧按长边不超过 1280 缩放后再送 Worker

#### Scenario: 帧数上限

- **WHEN** 用户或默认策略请求超过 48 帧
- **THEN** 服务端夹取到 48 并可在报告中注明实际采样数

### Requirement: 报告契约版本 1

完成态作业 MUST 产出 `version: 1` 报告，至少包含：源媒体指纹、探测元数据（时长、宽高、fps）、整体 `confidence`（high/medium/low）、`keyframes[]`（时间 `t`、相对位姿、可选 `fovDeg`、单帧置信度）、中文 `motionSummaryZh`、`mappingNote`（项目画幅与有效出片时长说明）、`warnings[]`。

#### Scenario: 首帧为原点

- **WHEN** 报告包含多条关键帧
- **THEN** `t=0` 的相机位姿为相对坐标系原点，后续帧为相对该原点的位姿

#### Scenario: 低置信警告

- **WHEN** Worker 判定输入为强风格化或重建不可靠
- **THEN** `confidence` 为 `low` 且 `warnings` 非空

### Requirement: 作业产物隔离与 TTL

几何分析产物 SHALL 仅存于仓库根下 `.vggt-jobs/<jobId>/`；作业目录 MUST 被版本控制忽略；完成或失败超过配置 TTL（默认 7 天）后 MAY 由清理任务删除。

#### Scenario: 不进入项目目录

- **WHEN** 分析完成
- **THEN** 报告文件路径保持在 `.vggt-jobs/` 下，不写入 `projects/` 或 `public/videos/` 作为调度产物

### Requirement: Worker 代理认证

当使用远程 Worker 时，服务端 MUST 使用配置的环境变量向 Worker 发起认证请求；MUST NOT 将 Worker token 下发到浏览器。

#### Scenario: 浏览器只访问本机 API

- **WHEN** 前端轮询作业
- **THEN** 请求仅到达本机 `/api/vggt/*`，不直接访问 Worker URL
