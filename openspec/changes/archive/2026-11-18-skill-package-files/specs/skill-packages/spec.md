# Spec Delta

## Purpose

定义技能包（Agent 包）从 zip 到磁盘的完整落地：安装时保存包内全部文件，读取时按目录优先级解析，卸载时不残留孤儿文件。

## ADDED Requirements

### Requirement: 安装保存包内全部文件

技能包安装 SHALL 保存 zip 内所有文件，不得只保留 `SKILL.md`。安装后的目录结构 MUST 与 zip 内（剥离公共顶层目录后）一致，层级与文件名不做重写。

#### Scenario: 市场安装保留 references

- **WHEN** 客户端 `POST /api/skillhub/install` 且该包 zip 含 `references/guide.md`
- **THEN** 安装目录内存在 `references/guide.md`，内容与 zip 内字节一致

#### Scenario: 上传 zip 保留子目录

- **WHEN** 客户端 `POST /api/skills/upload-zip` 提交含 `scripts/run.py` 与 `assets/a.json` 的包
- **THEN** 安装目录内两个文件都存在，且安装响应列出这两个路径

#### Scenario: 纯文本上传仍可安装

- **WHEN** 客户端以纯文本（非 zip）提交一个只有 `SKILL.md` 的包
- **THEN** 安装成功，该包目录内只有 `SKILL.md`，附加文件数为 0

### Requirement: 安装目录布局

已安装技能 SHALL 落在可写状态根下的 `installed-skills/<id>/`，与仓库内置的 `skills/<id>/` 同构且互不混写。安装 MUST NOT 写入随代码分发的只读目录。

#### Scenario: 默认开发环境落盘位置

- **WHEN** 未设置 `SB_STATE_ROOT`，应用根为仓库根
- **THEN** 安装目录为 `<仓库根>/installed-skills/<id>/`，且不出现于受版本控制的 `skills/` 下

#### Scenario: 桌面端落盘位置

- **WHEN** 桌面端注入 `SB_STATE_ROOT`
- **THEN** 安装目录位于该状态根下，卸载后不残留

### Requirement: 目录优先级

技能文件解析 SHALL 按「安装目录优先、内置目录回落」定位。同名技能存在安装时 MUST 使用安装目录；仅在安装目录缺失该文件时才回落内置目录。

#### Scenario: 安装覆盖内置

- **WHEN** 某 id 同时存在于安装目录与内置目录
- **THEN** 正文与附件均来自安装目录

#### Scenario: 回落内置

- **WHEN** 某 id 仅有内置目录
- **THEN** 正文与附件均来自内置目录，行为与未引入安装目录时一致

### Requirement: 读取包内文件

系统 SHALL 提供只读能力让 Pi 读取技能包内单个文件，而不要求把整包塞入上下文。读取 MUST 限定在该技能目录内，路径越界 MUST 以可读错误拒绝。

#### Scenario: 读取引用文件

- **WHEN** 模型对某技能请求 `references/guide.md`
- **THEN** 返回该文件文本内容

#### Scenario: 路径越界被拒绝

- **WHEN** 模型请求 `../../.env` 或绝对路径
- **THEN** 返回 `ok:false`，错误说明路径不合法，不读取任何内容

#### Scenario: 符号链接逃逸被拒绝

- **WHEN** 包内某文件是指向技能目录之外的符号链接
- **THEN** 读取被拒绝，不返回目标文件内容

#### Scenario: 文件不存在

- **WHEN** 模型请求包内不存在的文件名
- **THEN** 返回 `ok:false`，错误说明该文件不存在，并附该包现有文件清单

#### Scenario: 单文件大小上限

- **WHEN** 请求的文件超过单文件大小上限
- **THEN** 返回 `ok:false`，错误说明超出上限，不截断返回半份内容

### Requirement: 附件清单可见

技能列表 SHALL 为每个技能提供附件清单（相对路径、字节数）与文件计数，使「本包无附加文件」是可见状态。清单 MUST 与实际磁盘一致。

#### Scenario: 列出附件

- **WHEN** 客户端 `GET /api/skills`
- **THEN** 每个技能条目含附件路径与计数，仅有 `SKILL.md` 的包计数为 0

#### Scenario: 详情展示

- **WHEN** 用户在设置页打开某技能详情
- **THEN** 显示该包附件清单或明确的「无附加文件」提示

### Requirement: 卸载清理

卸载技能 SHALL 同时删除其安装目录与安装记录，不得残留孤儿文件。卸载内置技能 MUST 被拒绝。

#### Scenario: 卸载删除目录

- **WHEN** 客户端 `DELETE /api/skill-installs/<id>` 且该 id 来自安装
- **THEN** 安装记录与 `installed-skills/<id>/` 目录都不再存在

#### Scenario: 卸载内置被拒绝

- **WHEN** 客户端对仅存在于仓库 `skills/` 的 id 发起卸载
- **THEN** 返回 `ok:false`，内置文件不受影响

### Requirement: 安装失败不留半份数据

安装过程中任一步失败 SHALL 不留下可被当作已安装的半份目录或记录。校验失败 MUST 在写盘前拒绝。

#### Scenario: 校验失败不落盘

- **WHEN** zip 缺少 `SKILL.md` 或 `name` 与 id 不一致
- **THEN** 返回 `ok:false`，`installed-skills/` 下不出现该 id 的目录

#### Scenario: 覆盖安装中途失败

- **WHEN** 对同一 id 覆盖安装且写盘阶段失败
- **THEN** 原安装保持可用，不出现正文与附件来自不同批次的混合状态
