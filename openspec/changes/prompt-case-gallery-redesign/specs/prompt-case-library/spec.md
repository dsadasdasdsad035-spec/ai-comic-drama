# Spec Delta

## ADDED Requirements

### Requirement: 详情呈现不得改变列表布局

案例详情 SHALL 以覆盖式面板呈现（抽屉或等效覆盖层），MUST NOT 占用列表的列宽。打开与关闭详情 MUST NOT 改变列表的列数、条目尺寸或滚动位置。

系统 MUST NOT 在任何视口宽度下把详情渲染为列表内的一列或一个网格单元。

#### Scenario: 打开详情后列表不重排

- **WHEN** 用户在有 12 条结果的画廊里点开任意一张卡片
- **THEN** 列表中其余卡片的位置与尺寸 MUST 保持不变，卡片总数 MUST 保持不变

#### Scenario: 关闭详情后回到原位

- **WHEN** 用户关闭详情面板
- **THEN** 列表 MUST 保持在打开详情前的滚动位置与列布局

#### Scenario: 中等宽度下无窄条详情

- **WHEN** 视口宽度处于侧栏单列与多列之间的任意区间
- **THEN** 详情 MUST 以覆盖层呈现，MUST NOT 被压缩成窄条嵌入列表

### Requirement: 详情面板可键盘关闭并归还焦点

案例详情面板 SHALL 支持 `Escape` 关闭。面板 MUST 声明为模态对话框（`aria-modal`）并关联可读标题。关闭后焦点 MUST 归还到打开该面板的触发元素。

面板打开期间 MUST 阻止背景内容滚动，且焦点 MUST 被约束在面板内部循环。

#### Scenario: Esc 关闭

- **WHEN** 详情面板打开，用户按下 Escape
- **THEN** 面板关闭，列表恢复可见

#### Scenario: 焦点归还

- **WHEN** 用户从某张卡片的打开按钮进入详情，随后按 Escape 关闭
- **THEN** 键盘焦点 MUST 回到该卡片的打开按钮

#### Scenario: 背景不滚动

- **WHEN** 详情面板打开，用户在面板外滚动
- **THEN** 列表 MUST NOT 滚动

### Requirement: 加载期间不得同时显示空态

案例列表 SHALL 区分「正在加载」「加载完成但无结果」「加载完成且库为空」三种状态。首次加载进行中 MUST NOT 显示「案例库还是空的」或「没有匹配的案例」这类空结果文案。

#### Scenario: 首屏加载不误报空库

- **WHEN** 用户首次切到提示词案例 Tab，列表数据尚未返回
- **THEN** 界面只显示加载提示，MUST NOT 同时出现空态文案

#### Scenario: 加载完成确实为空才显示空态

- **WHEN** 数据返回且条数为零
- **THEN** 界面显示空态，并且区分「筛选无结果」与「案例库为空」两种文案
