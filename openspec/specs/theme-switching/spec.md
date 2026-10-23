# theme-switching Specification

## Purpose

让工作台在夜间 Cinema Dark 与日间 Paper Studio 两套语义主题间切换，记住用户选择并在启动前应用，同时保证画布、Konva、React Flow 与所有控件在两种主题下都清晰可用。

## Requirements

### Requirement: 提供夜间与日间两套主题

系统 SHALL 提供 Night 与 Day 两套主题；Night MUST 保持当前 Cinema Dark 的视觉与布局，Day MUST 使用暖纸底与深色文字而非简单反色。顶栏、集栏、画布、分镜卡、Inspector、时间线、菜单和 Toast MUST 从同一套语义主题取值。

#### Scenario: 夜间保持现状

- **WHEN** 用户处于夜间主题
- **THEN** 主要表面、文字、强调色和布局与当前深色工作台一致

#### Scenario: 日间覆盖全界面

- **WHEN** 用户切到日间主题
- **THEN** 顶栏、集栏、画布、卡片、Inspector、时间线和浮层都变为浅色表面，不残留深色区块

### Requirement: 日间文字与强调色达到可读对比

日间主题 SHALL 保证正文、次级文字、弱化文字和强调色在其实际背景上达到 WCAG AA 的 4.5:1；强调色 MUST 使用适合浅底的颜色，MUST NOT 直接沿用夜间的高亮青色。focus ring 在两种主题下都 MUST 可见。

#### Scenario: 日间正文与次级文字

- **WHEN** 日间主题渲染正文、标签或时间码
- **THEN** 这些文字与所在面板/画布的对比度不低于 4.5:1

#### Scenario: 日间强调色

- **WHEN** 日间主题渲染选中态、主按钮或链接
- **THEN** 强调色与背景的对比度不低于 4.5:1，且不依赖低对比高亮色

#### Scenario: 键盘聚焦

- **WHEN** 用户用 Tab 聚焦主题开关或其他主要控件
- **THEN** 当前主题下都能看到清晰的 focus ring

### Requirement: 顶栏提供明确的主题切换

系统 SHALL 在顶栏提供日间/夜间切换，带可见文字和当前状态；控件 MUST 支持键盘操作，MUST 用 `aria-pressed` 或等价语义表达选中状态，MUST NOT 只靠颜色区分。窄屏下标签 MUST 保持可读，不能退化成无标签的空白按钮。

#### Scenario: 鼠标切换

- **WHEN** 用户点击「日间」或「夜间」
- **THEN** 主题立即切换，按钮选中状态同步更新

#### Scenario: 键盘切换

- **WHEN** 用户用 Tab 聚焦开关并按 Enter/Space
- **THEN** 主题切换，焦点和选中状态保持可感知

#### Scenario: 窄屏显示

- **WHEN** 视口缩到手机宽度
- **THEN** 切换控件仍有可见文字或明确图标，且不会与项目选择、导出等顶栏操作重叠

### Requirement: 首屏主题跟随系统并可记忆

系统 SHALL 在用户没有保存过偏好时跟随 `prefers-color-scheme`；系统没有可用信号时 MUST 回落夜间。用户手动切换后 MUST 记住选择，并在刷新、重新打开应用后继续使用；本地存储不可用时 MUST 回落到系统/夜间且不阻断页面。

#### Scenario: 首次打开跟随系统

- **WHEN** 用户从未选择过主题，系统偏好为浅色
- **THEN** 首次打开显示日间主题；系统偏好为深色时显示夜间

#### Scenario: 手动选择被记住

- **WHEN** 用户切到日间后刷新页面
- **THEN** 页面仍以日间主题启动

#### Scenario: 存储不可用

- **WHEN** 浏览器禁止或清空本地存储
- **THEN** 页面仍能按系统偏好或夜间正常显示，切换在当前会话内有效

### Requirement: 主题在首次绘制前应用

系统 MUST 在应用首屏绘制前确定并应用主题，MUST NOT 先显示错误主题再切换。刷新已保存日间主题的页面时，首帧就应是日间表面。

#### Scenario: 刷新已保存主题

- **WHEN** 用户已保存日间主题并刷新
- **THEN** 首屏不会先闪出夜间背景再变成日间

### Requirement: 画布与原生控件跟随主题

系统 SHALL 让 React Flow 背景点、MiniMap、Konva 空白卡与三分线、镜头关系边色、原生 select、滚动条和表单控件跟随当前主题。日间模式 MUST NOT 出现深色画布点、深色迷你地图或看不清的关系线。

#### Scenario: 日间画布

- **WHEN** 日间主题打开画布
- **THEN** 背景点、MiniMap、空白分镜卡和三分线与浅色画布协调，关系边仍可辨认

#### Scenario: 原生控件

- **WHEN** 日间主题打开 Inspector 或设置页
- **THEN** select、滚动条和输入控件的原生外观与浅色主题一致

### Requirement: 图片与视频不被主题改色

主题切换 MUST 只改变工作台界面，MUST NOT 对分镜静帧、生成图、视频、标注颜色做反色或滤镜处理；同一张图在日间和夜间应保持原始颜色。

#### Scenario: 切换主题后的画面

- **WHEN** 用户在日间与夜间之间切换
- **THEN** 分镜图片和视频的颜色不发生变化

### Requirement: 切换不改变布局且尊重减少动效

主题切换 MUST NOT 改变元素尺寸、位置、间距或画布节点坐标。颜色过渡 SHOULD 在 300ms 内完成；`prefers-reduced-motion` 下 MUST 关闭过渡。

#### Scenario: 布局稳定

- **WHEN** 用户切换主题
- **THEN** 顶栏、卡片、Inspector 和时间线不跳动、不重排

#### Scenario: 减少动效

- **WHEN** 系统开启减少动态效果
- **THEN** 主题切换即时完成，不播放颜色过渡动画

### Requirement: 主题偏好不写入项目内容

主题偏好 MUST 只保存在浏览器本地，MUST NOT 修改项目镜头、设计、素材或画布业务数据，MUST NOT 因切换主题把项目标记为已修改。

#### Scenario: 打开项目时切换主题

- **WHEN** 用户打开一个项目并切换主题
- **THEN** 项目文件、镜头数据和画布节点内容保持不变
