# Spec Delta

## ADDED Requirements

### Requirement: 素材页镜头语言浏览

素材工作台 SHALL 提供「镜头语言」区域，用于浏览内置运镜库与镜头语法（与 scene/prop 设定拆解流分离），支持搜索、章节分组与视频预览。

#### Scenario: 浏览基础运镜章

- **WHEN** 用户打开素材页镜头语言并筛选 section=1
- **THEN** 展示 001–008 条目及中文运镜名

#### Scenario: 发布为素材卡

- **WHEN** 用户从镜头语言区选用一条预置并确认发布
- **THEN** 系统创建画布 `video` 素材卡且 MUST NOT 自动连线到分镜
