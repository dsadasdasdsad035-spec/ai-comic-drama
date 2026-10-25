# Spec Delta

## Purpose

把台词变成一条可预览、可导出、可校验的共享字幕轨，让连播和成片使用同一份 cue 时间与文本。

## ADDED Requirements

### Requirement: 共享 cue 构建

系统 SHALL 从镜头台词生成确定性的字幕 cue，并让连播、时间线、导出和校验共用同一份结果。默认按换行和中文句末标点切句；句内过长时按逗号/顿号再切。cue MUST 保留说话人到单独字段，显示文本默认去掉「角色：」前缀。

#### Scenario: 多行台词
- **WHEN** 一个镜头的台词有三行
- **THEN** 生成最多三条 cue，按行和标点顺序排列

#### Scenario: 说话人前缀
- **WHEN** 台词是「陈默：你来了。」
- **THEN** cue 的显示文本是「你来了。」，speaker 字段保留「陈默」

#### Scenario: 过长单句
- **WHEN** 一句台词超过默认单行长度
- **THEN** 优先在逗号/顿号处切成多条 cue，不把整句塞进一条

#### Scenario: 旧项目
- **WHEN** 打开一个没有字幕 cue 数据的旧项目
- **THEN** 从现有 `dialogue` 派生 cue，不要求迁移或改写项目文件

### Requirement: cue 时间相对镜头起点

cue 对象 MUST 用相对镜头起点的 `startOffsetMs/endOffsetMs` 表示时间，预览加上段起点得到绝对时间，导出由服务端加上真实段起点。有 TTS 时按配音时长和 `voiceOffset` 分配；没有 TTS/native 时按镜头时长估算并标记为估算。`subOffset` MUST 平移整镜 cue，且 cue 不得越过镜头边界或彼此重叠。

#### Scenario: TTS 多句
- **WHEN** 一个 5 秒镜头有 3.2 秒配音和三条 cue
- **THEN** 三条 cue 在 3.2 秒配音区间内按文本长度分配，并从 `voiceOffset` 之后开始

#### Scenario: 字幕偏移
- **WHEN** 用户把该镜 `subOffset` 增加 0.5 秒
- **THEN** 所有 cue 平移 0.5 秒，超出镜头末尾的部分被夹紧并产生警告

#### Scenario: 原生音频
- **WHEN** 镜头使用 native 音频、没有逐词时间
- **THEN** cue 按镜头时长估算并标记为估算，不声称与语音精确对齐

#### Scenario: 无重叠
- **WHEN** 两条 cue 计算后时间重叠
- **THEN** 系统调整或拆分，保证 cue 按顺序不重叠

### Requirement: 连播字幕 overlay

连播 SHALL 根据当前播放头显示活动 cue 的字幕 overlay；字幕显示/隐藏 MUST 有独立于「导出烧录字幕」的开关。字幕默认不包含说话人前缀，MUST 使用与导出共享的字号和底部安全区参数。

#### Scenario: 字幕随播放头出现
- **WHEN** 播放头进入某条 cue 的起止区间
- **THEN** 画面显示该 cue 文本；离开区间后隐藏

#### Scenario: 预览开关
- **WHEN** 用户关闭预览字幕
- **THEN** 画面不再显示字幕，但导出烧录开关不受影响

#### Scenario: 估算字幕
- **WHEN** 当前 cue 来自 native 或无配音镜头的估算
- **THEN** 预览可以显示「估算」状态，不把它标成配音同步

### Requirement: SRT 与 sidecar 一致

导出 SHALL 从同一份 cue 生成 SRT；有 libass 时烧录用这份 SRT，用户下载的 SRT sidecar MUST 与烧录内容逐字一致。SRT MUST 使用 cue 的起止时间、保留 cue 内换行、默认不含说话人前缀。

#### Scenario: 下载 SRT
- **WHEN** 用户导出带字幕的成片并下载 SRT
- **THEN** SRT 的 cue 文本和时间与烧录/预览使用的一致

#### Scenario: 多行 cue
- **WHEN** 一条 cue 文本包含换行
- **THEN** SRT 和画面字幕保留该换行，不压成一行

#### Scenario: 关闭烧录
- **WHEN** 用户关闭「导出烧录字幕」后导出
- **THEN** 成片不带字幕，SRT 入口也不提供本次导出的字幕文件

### Requirement: PNG 兜底按 cue 定时

没有 libass 时，系统 SHALL 为每条 cue 生成透明 PNG 并按 cue 起止时间叠加，MUST NOT 再用一张整镜 PNG 覆盖整段。`subOffset`、`voiceOffset` 和 cue 时间 MUST 在兜底路径同样生效。

#### Scenario: 两条 cue 先后出现
- **WHEN** 一个镜头有两条不重叠的 cue
- **THEN** 第一条只在它的区间出现，第二条在后续区间出现，不整镜同时显示

#### Scenario: 偏移生效
- **WHEN** 用户在无 libass 环境下拖动字幕偏移
- **THEN** PNG 字幕的出现/消失时间随之移动，与有 libass 环境一致

### Requirement: 共享字幕样式

预览和导出 SHALL 使用同一套样式参数：字号按画面高度比例、底部安全区、最大宽度、描边/底色和对齐方式。SRT 路径 MUST 使用可用的 CJK 字体；无法确认 CJK 字体可用时 MUST 回退到 PNG 或明确警告，不能静默输出方框字。

#### Scenario: 预览与导出字号一致
- **WHEN** 同一 cue 在 720p 下预览和导出
- **THEN** 字号、底部位置和最大宽度使用同一组比例参数

#### Scenario: 缺少 CJK 字体
- **WHEN** 服务端 libass 可用但没有可用 CJK 字体
- **THEN** 系统回退到 PNG 字幕或显示字体警告，不输出方框

### Requirement: 字幕校验

导出前 SHALL 校验 cue：空文本、起止倒置、超出镜头、cue 重叠、单行过长、行数过多和阅读速度。错误 MUST 阻止导出，警告 MUST 要求用户确认或明确列出。校验结果 MUST 可从导出面板看到。

#### Scenario: 时间错误
- **WHEN** 两条 cue 时间重叠或有一条超出镜头
- **THEN** 导出被阻止，并列出具体镜头和原因

#### Scenario: 阅读速度过快
- **WHEN** 某条 cue 超过 12 字/秒
- **THEN** 导出被阻止并要求拆句或延长时长

#### Scenario: 单行过长
- **WHEN** 某条 cue 超过默认单行字数但没有时间错误
- **THEN** 显示警告，用户确认后仍可导出

### Requirement: 时间线显示 cue 块

时间线字幕行 SHALL 按实际 cue 起止显示多个块，而不是一个镜头宽的整块；拖动字幕行仍作为该镜整组 cue 的 `subOffset` 平移。cue 的逐条拖拽/拉伸/文本编辑不在本次范围内。

#### Scenario: 多 cue 显示
- **WHEN** 一个镜头生成三条 cue
- **THEN** 字幕行显示三个按时间排列的块

#### Scenario: 整镜平移
- **WHEN** 用户拖动该镜字幕行
- **THEN** 三条 cue 一起平移，`subOffset` 更新

### Requirement: 字幕不改变台词与配音数据

字幕 cue MUST 是可重复派生的只读结果；生成、预览、校验和导出 MUST NOT 改写 `dialogue`、`voiceUrl`、`voiceSeconds`、`subOffset` 或 `voiceOffset`。本变更 MUST NOT 新增持久化的 cue 字段。

#### Scenario: 预览不写项目
- **WHEN** 用户播放、seek 或切换字幕开关
- **THEN** 项目文件和镜头数据不被修改

#### Scenario: 导出不写台词
- **WHEN** 用户导出成片
- **THEN** 台词和配音字段保持原样，字幕只存在于本次导出的 cue 结果中

### Requirement: 预览、导出和 QC 使用同一 cue

连播 overlay、SRT、PNG 兜底和导出前校验 MUST 读取同一个 cue 构建结果；MUST NOT 在导出时再单独从 `dialogue` 解析一套字幕。

#### Scenario: 同一批 cue
- **WHEN** 同一镜头先连播再导出
- **THEN** 两处使用的 cue 数量、文本和相对时间一致
