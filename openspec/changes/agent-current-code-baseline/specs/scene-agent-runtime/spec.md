# Spec Delta

## ADDED Requirements

### Requirement: 当前镜头已有代码可作为运行基线

agent 在本轮开始前 SHALL 能取得当前工作台镜头的代码草稿；若该代码通过现有安全检查，运行工具 MUST 可以直接运行它，MUST NOT 因为本轮尚未调用 `set_scene_code` 而拒绝。需要改变场景时仍 MUST 通过 `set_scene_code` 提交新代码。

#### Scenario: 已有代码直接运行

- **WHEN** 当前镜头已有通过检查的代码，用户要求“运行当前场景”
- **THEN** agent 可以直接运行该代码并抓帧/验收，不出现“还没有提交代码”

#### Scenario: 空镜头

- **WHEN** 当前镜头没有代码，agent 直接调用运行工具
- **THEN** 工具返回需要先提交代码，不伪造运行成功

#### Scenario: 无效代码

- **WHEN** 当前草稿未通过安全检查
- **THEN** 不把它作为可运行基线；agent 必须先提交有效代码

#### Scenario: 修改场景

- **WHEN** 用户要求改变画面或场景
- **THEN** agent 仍通过 `set_scene_code` 提交新代码，再运行沙箱

#### Scenario: 后续消息

- **WHEN** 用户在一次运行后继续发“再运行一次”或“继续验收”
- **THEN** 新一轮仍使用当前工作台的最新有效代码作为基线

#### Scenario: 镜头隔离

- **WHEN** agent 读取或运行基线代码
- **THEN** 只使用当前镜头的代码，不读取或写入其他镜头
