# Spec Delta

## MODIFIED Requirements

### Requirement: 物料地图可按分类列出轻量行

当 `read_asset_inventory` 收到 `category` 与 `includeRows: true` 时，系统 SHALL 返回该分类的轻量行。每行 MUST 包含 `category`、`key` 与可读标题；`assets` 分类的每一行 MUST 额外包含该素材的画布身份 `canvasId`（存在时），使调用方能把它与 `shot.refIds` 里的 `asset-<canvasId>` token 对上。系统 MUST NOT 在该响应中包含白模代码正文、图片数据地址或视频数据地址。行数 MUST 受 `limit` 约束（默认 50，上限 200），被截断时 MUST 明确标记。

#### Scenario: 列出素材卡并细分类型

- **WHEN** agent 以 `category: "assets"`、`includeRows: true` 调用，且项目有 12 张视频素材卡
- **THEN** 返回的行中每一项都带 `key`、视频标记与 `canvasId`，计数显示视频 12 张

#### Scenario: 按关键词与类型过滤

- **WHEN** agent 传入 `q` 与 `kind`
- **THEN** 只返回标题或类型匹配的条目

#### Scenario: 超过上限被截断

- **WHEN** 某分类条目数超过 `limit`
- **THEN** 响应标记截断，并返回该分类的总数

## ADDED Requirements

### Requirement: 素材卡可按画布 token 反查

系统 SHALL 允许 `read_asset_detail` 以素材卡在分镜 `refIds` 里出现的形态定位记录：`category: "assets"` 时 `key` MUST 同时接受 `read_asset_inventory` 返回的 `key`、裸 `canvasId`、以及 `asset-<canvasId>` 三者中的任意一种。三者 MUST 解析到同一条记录。无法解析时 MUST 返回可读错误，并提示先用 `read_asset_inventory` 取行。

#### Scenario: 用 refIds 里的 token 钻取

- **WHEN** 镜头 `refIds` 含 `asset-cv1`，agent 以 `category: "assets"`、`key: "asset-cv1"` 调用 `read_asset_detail`
- **THEN** 返回该素材卡的完整记录，含标题、类型与文件地址

#### Scenario: 裸画布身份等价

- **WHEN** agent 以同一素材的裸 `canvasId: "cv1"` 调用
- **THEN** 返回与 `asset-cv1` 完全相同的记录
