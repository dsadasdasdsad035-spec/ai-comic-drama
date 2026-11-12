# shot-3d-reference-ingest Specification

## Purpose
在 3D 调度工作台内将抖音/B 站等平台链接或本地上传转化为项目内参考视频，供镜头上下文选择与 VGGT 几何分析使用。

## Requirements

### Requirement: 项目镜头参考摄取 API

系统 SHALL 提供 `POST /api/shot-3d/ingest-reference`，接受当前 `projectName`、可选 `entryId`（仅审计）、以及 `url` 或 Base64 文件（`data`/`name`）。摄取 MUST 复用与创意室相同的 `ingest.mjs` 适配器与 SSRF 规则；配置 MUST 来自设置中的创意摄取段（yt-dlp、DTK），不得为白模工作台单独维护一套密钥。入口 MUST 位于素材 → 镜头语言 → 自定义白模工作台的「几何」页签。

#### Scenario: 平台链接成功

- **WHEN** 用户提交已启用适配器可解析的抖音或 B 站链接
- **THEN** 服务端下载视频到当前项目 assets，返回站内 `/project-assets/...` URL 与 probe 元数据

#### Scenario: 本地上传成功

- **WHEN** 用户提交符合大小与扩展名约束的上传体
- **THEN** 文件写入项目 assets 并返回站内 URL

#### Scenario: 适配器不可用

- **WHEN** 链接需要 yt-dlp 或 DTK 但未配置或探测失败
- **THEN** 请求失败并返回明确原因，不静默改用直链解析 HTML

#### Scenario: 缺少项目

- **WHEN** `projectName` 无效或未选项目
- **THEN** 返回错误，不写盘

### Requirement: 摄取产物为项目内持久资产

摄取成功的视频 MUST 存放在 `projects/<项目>/assets/`，URL 形态为 `/project-assets/<项目>/<文件名>`。单文件大小 MUST 不超过与创意摄取相同的字节上限（默认 200MB）。

#### Scenario: 可备份迁移

- **WHEN** 用户复制整个 `projects/` 目录
- **THEN** 参考视频与项目数据一并可用

#### Scenario: 超限拒绝

- **WHEN** 下载或上传超过上限
- **THEN** 摄取失败，不写入部分文件（或清理临时文件）

### Requirement: 摄取结果默认不自动写入调度真相

摄取 API MUST NOT 修改任何分镜字段，也 MUST NOT 修改白模条目的 `sceneCode`、`video`、`scheduleMeta` 或 `sceneCodeMeta`。摄取结果 MUST 只在本工作台会话内作为几何分析来源，MUST NOT 创建或改写任何按镜头保存的参考选择。

#### Scenario: 仅工作台草稿

- **WHEN** 摄取成功且用户未触发几何分析
- **THEN** 项目文件中没有新增参考选择或视频字段，刷新前仅会话内来源列表可见

#### Scenario: 摄取失败无脏数据

- **WHEN** 摄取失败或中途取消
- **THEN** 白模条目与分镜数据都与摄取前一致

### Requirement: 与 VGGT 分析衔接

摄取返回的站内 URL MUST 可作为既有 `/api/vggt/analyze` 的 `videoRef`（含 `/project-assets/`）。系统 MUST NOT 在摄取成功时自动提交 VGGT 作业，除非用户显式触发几何分析。

#### Scenario: 手动串联

- **WHEN** 用户摄取后点击几何分析
- **THEN** 使用刚得到的 `videoRef` 创建 VGGT 作业，行为符合 `reference-video-geometry`

#### Scenario: 已渲染条目也可分析

- **WHEN** 当前白模条目已有渲染视频
- **THEN** 该视频作为只读来源进入几何分析，分析结果 MUST NOT 回写代码或视频字段
