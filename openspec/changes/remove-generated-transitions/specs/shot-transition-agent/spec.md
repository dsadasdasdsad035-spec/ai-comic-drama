# Spec Delta

## REMOVED Requirements

### Requirement: 建议须含可执行摘要

**Reason**: 建议的产物是 `mode: generated` 加上转场提示词与食谱引用，这两样都随生成转场退役。`POST /api/transition/suggest` 在删除前已无前端调用方，属于死代码。

**Migration**: 旧接口 `/api/transition/suggest` 移除。转场类型的选择改由人直接在接缝设置里选预设；Agent 仍可通过 `submit_joins` 写入效果预设与时长。

### Requirement: 确认后才写入

**Reason**: 该要求的核心是「生成类建议必须先经用户确认才能写入 `generated`」；生成类建议不复存在后，没有需要二次确认的写入路径。

**Migration**: 无。`submit_joins` 仍只写效果配置，且仍遵循工作台草稿的确认/保存语义。
