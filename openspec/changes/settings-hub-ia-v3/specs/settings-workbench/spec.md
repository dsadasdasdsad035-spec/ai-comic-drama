# Spec Delta

## Purpose

定义设置视图的任务导向外壳：五枢纽导航、枢纽内二级分区、健康状态与深链入口，使用户在不改变底层设置契约的前提下完成连接、管线、扩展、费用与数据管理。

## ADDED Requirements

### Requirement: 五枢纽一级导航

系统 SHALL 在设置视图提供且仅提供五个一级枢纽：连接与模型、制作管线、智能与扩展、费用、数据。用户 MUST 能通过一级导航在枢纽间切换；任一时刻 MUST 有且只有一个激活枢纽，并以 `aria-current` 或等价语义与可见激活态表达。

#### Scenario: 默认进入连接枢纽

- **WHEN** 用户从工作台进入设置且未指定 `initialSection`
- **THEN** 激活枢纽为「连接与模型」，并显示该枢纽的默认子 Tab（渠道）

#### Scenario: 一级项数量固定

- **WHEN** 用户查看设置左侧或等效的一级导航
- **THEN** 导航中恰好出现五个枢纽名称，且不含旧的扁平「高级」分隔列表作为唯一入口

### Requirement: 枢纽内二级 Tab

每个枢纽 SHALL 用二级 Tab 组织现有设置分区。连接与模型 MUST 包含渠道与模型库；制作管线 MUST 包含默认路由、口型与音色；智能与扩展 MUST 包含总览、Agent、创意、技能、MCP、创意专家与素材库；费用 MUST 包含计价与账户与充值；数据 MUST 为单页（无二级 Tab 或仅一页）。切换二级 Tab MUST NOT 丢失未保存的全局草稿状态。

#### Scenario: 连接枢纽子 Tab

- **WHEN** 用户在「连接与模型」下选择「模型库」
- **THEN** 显示现有模型库 UI（搜索、筛选、目录同步能力保持不变）

#### Scenario: 费用枢纽子 Tab

- **WHEN** 用户在「费用」下切换到「账户与充值」
- **THEN** 显示现有计费登录、余额与流水 UI，计价 Tab 内容不可见

#### Scenario: 素材库归属扩展枢纽

- **WHEN** 用户在「智能与扩展」下打开「素材库」
- **THEN** 显示现有素材库渠道配置，且该入口 MUST NOT 出现在「制作管线」下

### Requirement: 动态顶栏语境

设置主内容区顶栏 SHALL 显示「设置 · {当前枢纽名}」为主标题，并显示一行与该枢纽任务相关的副标题。副标题 MUST 随枢纽切换而更新，MUST NOT 在所有枢纽下固定为「渠道、模型与默认路由」。

#### Scenario: 扩展枢纽副标题

- **WHEN** 用户激活「智能与扩展」
- **THEN** 顶栏主标题包含「智能与扩展」，副标题说明 Agent、创意助手与扩展安装一类任务

#### Scenario: 保存控件保持全局

- **WHEN** 用户在任一击纽或子 Tab 下修改设置草稿
- **THEN** 顶栏仍显示全局「未保存」提示与「保存设置」按钮，行为与改前一致

### Requirement: 健康状态条可导航

设置视图 SHALL 保留健康状态条。缺 Key、余额不足、失效默认等芯片 MUST 可点击，并 MUST 导航到能解决该问题的枢纽与子 Tab。无问题时 MUST 显示可读的正常状态文案。

#### Scenario: 缺 Key 跳转

- **WHEN** 状态条显示缺 Key 芯片且用户点击
- **THEN** 激活「连接与模型」枢纽并显示渠道子 Tab

#### Scenario: 失效默认跳转

- **WHEN** 状态条显示失效默认芯片且用户点击
- **THEN** 激活「制作管线」枢纽并显示默认路由子 Tab

### Requirement: 深链与 initialSection 兼容

系统 SHALL 继续接受既有 `SettingsInitialSection` 值及从创意工作室等入口传入的 `settingsSection`。每个 legacy section id MUST 映射到唯一枢纽与子 Tab，打开后 MUST 展示与改前相同的功能内容。

#### Scenario: 技能深链

- **WHEN** 应用以 `settingsSection: 'skills'` 打开设置
- **THEN** 激活「智能与扩展」与技能子 Tab，并保留技能市场/已安装子视图行为

#### Scenario: MCP 与专家深链

- **WHEN** 应用分别以 `mcp` 或 `experts` 打开设置
- **THEN** 激活「智能与扩展」下对应子 Tab

### Requirement: 制作管线预览摘要

在「制作管线 · 默认路由」子 Tab 顶部，系统 SHALL 显示只读管线预览，至少包含拆镜（shot 环节）、出画面（image 能力）、出片（video 能力）、配音（audio 能力）当前解析出的模型显示名。预览 MUST 随草稿变更更新，MUST NOT 单独持久化。

#### Scenario: 预览随草稿变化

- **WHEN** 用户修改默认路由中 video 默认值且尚未保存
- **THEN** 管线预览中出片一行反映新选模型显示名

#### Scenario: 预览下方保留细调

- **WHEN** 用户查看默认路由页
- **THEN** 预览下方仍可编辑按能力与按环节的两级路由控件

### Requirement: 智能与扩展总览

「智能与扩展 · 总览」SHALL 提供只读摘要卡片，链向 Agent、创意、技能、MCP、专家等子 Tab，并显示可获得的安装/配置数量或状态摘要。总览 MUST NOT 替代子 Tab 内的完整编辑能力。

#### Scenario: 从总览进入技能

- **WHEN** 用户在总览点击技能相关入口
- **THEN** 切换到技能子 Tab

### Requirement: 窄屏设置导航可用

视口宽度不超过 980px 时，设置一级导航 MUST 保持可访问：允许横向滚动或使用等效控件，MUST NOT 同时挤压出现超过五个无法辨认的一级项。二级 Tab 在智能与扩展等多 Tab 枢纽下 MUST 仍可切换（允许横滑或收纳，不得隐藏子 Tab）。

#### Scenario: 窄屏进入设置

- **WHEN** 视口宽度为 375px 且用户打开设置
- **THEN** 用户仍可选择五个枢纽之一并打开连接·渠道内容

### Requirement: 验收稳定选择器

设置外壳 MUST 为一级枢纽、二级 Tab 与关键分区提供稳定的 `data-settings-hub`、`data-settings-pane` 属性（或文档化的等价测试钩子），以便自动化验收不依赖导航按钮的可见文案。

#### Scenario: 验收定位渠道

- **WHEN** 自动化脚本以 `data-settings-pane="providers"` 查询
- **THEN** 在渠道子 Tab 激活时可找到对应分区根节点