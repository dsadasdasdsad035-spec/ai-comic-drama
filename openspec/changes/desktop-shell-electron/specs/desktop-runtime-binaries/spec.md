# Spec Delta

## Purpose

让安装包自带运行所需的全部可执行依赖，使用户机器上不必预装 Node、ffmpeg 或 Blender 即可完成生成、抽帧、口型与 3D 白模全流程，同时在依赖缺失或版本不符时给出明确的可操作提示。

## ADDED Requirements

### Requirement: 自带 Node 运行时

应用 SHALL 使用随包分发的运行时执行本地服务，MUST NOT 依赖用户机器上已安装的 Node。随包的运行时版本 MUST 满足服务端代码对内置 SQLite 模块的要求。

#### Scenario: 用户机器没有 Node

- **WHEN** 在一台未安装 Node 的机器上运行应用
- **THEN** 本地服务正常启动并可用，不需要用户额外安装任何运行时

#### Scenario: 运行时版本不满足要求

- **WHEN** 随包运行时无法加载服务端使用的内置 SQLite 模块
- **THEN** 该组合 MUST NOT 被发布；应用在启动自检阶段给出明确错误，而不是在使用到数据库时才崩溃

### Requirement: 随包 ffmpeg 与 ffprobe

应用 SHALL 随包提供 ffmpeg 与 ffprobe，并把其绝对路径通过环境变量提供给服务进程。MUST NOT 依赖用户机器上通过包管理器安装的副本。

#### Scenario: 抽帧与分析可用

- **WHEN** 用户在未安装 ffmpeg 的机器上对视频执行抽帧或时长探测
- **THEN** 操作使用随包的可执行文件成功完成，不调用系统副本

#### Scenario: 用户显式指定自己的 ffmpeg

- **WHEN** 用户设置了指向自定义 ffmpeg 的环境变量
- **THEN** 该路径优先于随包副本生效

#### Scenario: ffprobe 与 ffmpeg 同源

- **WHEN** 服务需要探测媒体信息
- **THEN** 使用的 ffprobe MUST 来自与 ffmpeg 相同的分发目录，避免版本不匹配

### Requirement: 随包 Blender

应用 SHALL 随包提供 Blender，并把其可执行文件绝对路径通过环境变量提供给服务进程。应用 MUST 在应用内提供该 Blender 的版本号、来源与许可证文本。

#### Scenario: 3D 白模渲染可用

- **WHEN** 用户在未安装 Blender 的机器上触发 3D 场景渲染
- **THEN** 渲染使用随包的 Blender 成功完成

#### Scenario: 许可证可得

- **WHEN** 用户查看应用的第三方组件说明
- **THEN** 能看到随包 Blender 的版本、来源地址与完整许可证文本

### Requirement: 应用内二进制路径解析

当应用内并未注入显式路径时，服务端 SHALL 能在应用资源目录中定位随包二进制。解析顺序 MUST 为：显式环境变量 → 应用资源目录 → 系统常见安装路径 → `PATH`。

#### Scenario: 未注入环境变量

- **WHEN** 服务进程未收到任何二进制路径变量
- **THEN** 仍能命中应用资源目录中的随包副本

#### Scenario: 路径含空格与中文

- **WHEN** 应用安装路径包含空格或中文字符
- **THEN** 二进制仍能被正确执行，不因引号或编码失败

#### Scenario: 二进制缺失

- **WHEN** 应用资源目录中找不到所需的二进制
- **THEN** 相关能力返回可读的不可用说明，其余功能 MUST NOT 一并失效
