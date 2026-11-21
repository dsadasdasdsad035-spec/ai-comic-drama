# Spec Delta

## MODIFIED Requirements

### Requirement: 空态与提示指向 Agent

剧本卡片墙在无分集时 SHALL 提示用户前往创意工作室生成分集，或使用「导入剧本大纲」灌入任意剧本文本（格式可后改）；MUST NOT 指引已移除的顶栏拆集或左栏原著表单。空态与导入对话框的帮助文案 MUST NOT 要求用户事先写成 short-drama 场标题格式。

#### Scenario: 无分集空态

- **WHEN** 项目尚无 `episodes` 登记且未导入
- **THEN** 空态说明可通过创意 Agent 生成分集或导入大纲文本，并提示规范格式可经 Agent 修改

## ADDED Requirements

### Requirement: 导入大纲对话框不阻断确认

剧本视图「导入剧本大纲」在解析产生可合并的 `episodes` 时 SHALL 启用「确认导入」，即使存在解析 warnings。对话框 MUST NOT 因 `blocked` 或仅 `format.kind === free-text` 而禁用确认；空内容、无项目、写入失败等基础设施错误除外。

#### Scenario: 有 warnings 仍可导入

- **WHEN** 用户粘贴杂散 Markdown 且预览显示多场占位 warnings
- **THEN** 「确认导入」可点击，合并后卡片墙反映新集次

#### Scenario: 仅空内容不可导入

- **WHEN** 用户未粘贴任何非空文本
- **THEN** 确认按钮不可用，不出现契约类 blocked 文案