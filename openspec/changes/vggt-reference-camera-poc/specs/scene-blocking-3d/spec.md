# Spec Delta

## ADDED Requirements

### Requirement: 参考片几何分析不得构成调度真相

参考片几何分析（实验）的成功、失败、取消或进行中，系统 MUST NOT 写入或覆盖当前镜头的 `sceneCode`、`schedule_video`、`scheduleMeta`、`sceneCodeMeta` 或等价调度字段；分析报告 MUST NOT 自动作为 Seedance `reference_video`、抽帧参考或项目持久化字段。

#### Scenario: 分析成功不落库

- **WHEN** 几何分析完成且用户未执行保存或渲染
- **THEN** 项目内镜头 3D 字段与进入分析前一致

#### Scenario: 分析失败不破坏有效调度

- **WHEN** 几何分析失败、超时或用户取消
- **THEN** 既有代码、参考选择、`schedule_video` 与元数据保持不变，界面显示失败原因

#### Scenario: 复制摘要不等于采纳

- **WHEN** 用户从实验面板复制运动摘要到聊天
- **THEN** 仍须通过既有 `run_render` 与保存门禁才能更新调度视频

### Requirement: 实验分析须与调度视频来源区分展示

工作台 MUST 标明几何分析所针对的视频是「参考片」还是「当前调度片」，避免用户将分析结果误当作已采纳的 `schedule_video`。

#### Scenario: 参考片分析

- **WHEN** 分析源来自 `Shot3DContext.videoUrls`
- **THEN** 面板标题或说明含「参考片」且不含「已保存调度」语义

#### Scenario: 调度片只读查看

- **WHEN** 用户选择对本镜已有 `schedule_video` 做只读分析
- **THEN** 界面明示该操作不验收、不替换已保存调度
