# Spec Delta

## ADDED Requirements

### Requirement: 专家派生配置幂等落盘

专家 preset 文件、专家镜像与技能根 SHALL 按内容幂等维护：内容等价的写入 MUST NOT 改动文件，MUST NOT 产生「已生成」类变更日志。技能根 MUST 只补缺失项、只删多余项，MUST NOT 整棵重建。

#### Scenario: 内容不变不写盘

- **WHEN** 连续两次以相同的专家定义、工具清单与技能集合生成 preset
- **THEN** 第二次不修改任何文件，文件的修改时间保持不变

#### Scenario: 内容变化才写入

- **WHEN** 某专家的 `soul`、工具白名单或技能白名单发生变化
- **THEN** preset 被重写，且内容指纹随之改变

#### Scenario: 技能根增量同步

- **WHEN** 专家技能白名单新增一个技能而其余不变
- **THEN** 技能根只新增该条目，已有条目不被替换或重建

#### Scenario: 变更日志不刷屏

- **WHEN** 应用长时间运行且专家配置未变化
- **THEN** 变更日志中不出现重复的 preset 生成记录
