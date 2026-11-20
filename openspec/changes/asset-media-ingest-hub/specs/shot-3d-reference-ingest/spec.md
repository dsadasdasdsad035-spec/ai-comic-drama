# Spec Delta

## MODIFIED Requirements

### Requirement: 项目镜头参考摄取 API

系统 SHALL 提供 `POST /api/shot-3d/ingest-reference`，接受当前 `projectName`、可选 `entryId`（仅审计）、以及 `url` 或 Base64 文件（`data`/`name`）。摄取 MUST 复用与创意室相同的 `ingest.mjs` 适配器与 SSRF 规则；配置 MUST 来自设置中的**素材/媒体摄取**段（展示上独立于创意会话；存储上 MAY 仍使用 `creative.ingest`）。**主用户入口** MUST 位于**素材视图**的链接下载 UI。

#### Scenario: 平台链接成功

- **WHEN** 用户在素材页提交已启用适配器可解析的抖音或 B 站链接
- **THEN** 服务端下载视频到当前项目 assets，返回站内 `/project-assets/...` URL 与 probe 元数据

#### Scenario: 本地上传成功

- **WHEN** 用户在素材页或仍暴露的上传入口提交符合大小与扩展名约束的上传体
- **THEN** 文件写入项目 assets 并返回站内 URL

#### Scenario: 适配器不可用

- **WHEN** 链接需要 yt-dlp 或 DTK 但未配置或探测失败
- **THEN** 请求失败并返回明确原因，不静默改用直链解析 HTML

#### Scenario: 缺少项目

- **WHEN** `projectName` 无效或未选项目
- **THEN** 返回错误，不写盘

## ADDED Requirements

### Requirement: 摄取成功同步视频素材目录

摄取 API 在成功写盘并 probe 通过后 MUST 将结果登记到 `project.assets` 作为视频条目（与 `asset-platform-video-ingest` 一致），以便素材视图与选择器可列举同一来源。

#### Scenario: API 与 assets 一致

- **WHEN** 摄取 API 返回 `videoUrl`
- **THEN** 同一项目持久化层中存在匹配该 URL 的视频素材记录
