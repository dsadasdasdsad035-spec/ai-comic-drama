# Spec Delta

## Purpose

在画布上通过「出图 / 出片」模式分离静帧生产与视频出片工位；出图参数与生成入口集中在 Inspector「画面」Tab，不使用画布浮动 Dock。

## ADDED Requirements

### Requirement: 画布提供出图与出片两种生产模式

系统 SHALL 在画布视图提供 `出图` 与 `出片` 两种互斥的生产模式；用户切换后 MUST 在同一浏览器会话中保持选择（SHOULD 持久化到 localStorage）。同一时间 MUST 只有一种模式处于激活状态。

#### Scenario: 默认进入出图模式

- **WHEN** 用户首次打开本项目的画布视图且尚无保存的模式偏好
- **THEN** 出图模式为激活状态

#### Scenario: 记住模式

- **WHEN** 用户切换到出片模式后刷新页面
- **THEN** 仍处于出片模式（在持久化可用时）

### Requirement: 出图工位在 Inspector 画面 Tab

出图模式下，用户选中分镜时，系统 SHALL 在 Inspector「画面」Tab 提供完整出图工位：画面提示词、出图设置（画幅/张数/模型/参考选项）、参考说明，以及吸底「生成画面」。MUST NOT 在画布内再展示独立的 Image Dock 浮动面板。卡头「生成」与 Inspector 出图设置 MUST 使用同一套全局出图配置。

#### Scenario: 出图模式无画布 Dock

- **WHEN** 出图模式激活且用户选中分镜
- **THEN** 画布内不存在 Image Dock，出图参数在右侧 Inspector 画面 Tab 可见

#### Scenario: 吸底可生成画面

- **WHEN** 出图模式、画面 Tab 激活且提示词非空
- **THEN** 吸底栏显示生成画面主操作

### Requirement: Inspector Tab 随模式显隐

出图模式下，分镜 Inspector MUST 仅显示 `画面` 与 `更多` Tab，MUST NOT 显示 `视频` Tab。出片模式下 MUST 仅显示 `视频` 与 `更多` Tab，MUST NOT 显示 `画面` Tab。两种模式 MUST NOT 显示 `声音` Tab。

#### Scenario: 出图模式 Tab 集合

- **WHEN** 画布处于出图模式且选中分镜
- **THEN** 可见 Tab 为画面与更多，且无声音 Tab

#### Scenario: 出片模式 Tab 集合

- **WHEN** 画布处于出片模式且选中分镜
- **THEN** 可见 Tab 为视频与更多，且无声音 Tab

### Requirement: 台词与表演在更多页编辑

系统 SHALL 在 `更多` Tab 提供台词与表演方向编辑（从原声音 Tab 迁移），以供字幕与出片提示词使用。系统 MUST NOT 在分镜 Inspector 提供镜头 TTS「生成配音」主操作。

#### Scenario: 更多页可编辑台词

- **WHEN** 用户在任一出图/出片模式下打开更多 Tab
- **THEN** 可编辑台词与表演，且不出现生成配音按钮
