# Spec Delta

## MODIFIED Requirements

### Requirement: 媒体选择有数量、尺寸和隐私边界

系统 MUST 限制同时选中的图片数量、单张图片尺寸、视频数量和每个视频的关键帧数量；超限 MUST 提示并拒绝新增，MUST NOT 静默截断。选择器 MUST 只展示当前项目或应用本地已知资源；**任意外链 http(s) 字符串 MUST NOT 直接写入 `videoUrls`**。用户 MAY 通过镜头参考摄取将平台链接或本地上传转为项目内 `/project-assets/`（或既有站内视频路径）后再勾选进入上下文。

#### Scenario: 图片超限

- **WHEN** 用户选择的图片达到上限后继续勾选
- **THEN** 新增被拒绝并提示上限

#### Scenario: 视频关键帧

- **WHEN** 一个视频被选中
- **THEN** 只抽取配置数量的关键帧，不把整段视频塞进聊天

#### Scenario: 外部地址

- **WHEN** 用户尝试把未摄取的外链粘贴为 3D 参考
- **THEN** 系统拒绝直接写入上下文，并引导使用「下载参考视频」摄取

#### Scenario: 摄取后可选中

- **WHEN** 摄取成功返回 `/project-assets/...`
- **THEN** 用户可将该 URL 加入本镜 `videoUrls`，并受视频数量上限约束

## ADDED Requirements

### Requirement: 3D 工作台提供参考视频摄取入口

3D 代码工作台的参考内容区 MUST 提供链接输入与本地上传（或等价控件），调用镜头参考摄取 API。成功后 MUST 可将视频加入当前镜头上下文草稿，并标明未保存状态。

#### Scenario: 加入草稿参考

- **WHEN** 摄取成功且用户确认加入参考
- **THEN** `videoUrls` 草稿包含新站内 URL，指纹/过期提示按既有规则更新

#### Scenario: 视频数量上限

- **WHEN** 加入后超过 `SCENE_CODE_LIMITS` 视频上限
- **THEN** 拒绝加入并提示，不挤掉已选视频
