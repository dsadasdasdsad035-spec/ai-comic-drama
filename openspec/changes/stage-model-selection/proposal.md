# Proposal

## Why

设置页的模型表已经能按「能力 → 渠道 + 模型 ID」配置文本模型（豆包 / DeepSeek / Kimi / GLM 等），但四个文本环节并没有真正使用它：剧本、镜头表、提示词只有写死的 lite/pro 档位，拆角色写死 pro，角色三视图的手选入口不存在；同时 `/api/text` 在收到 textPro 条目的 modelKey 时会静默回退到第一条 text 模型。用户既不能在环节里选具体模型，也无法从界面上确认实际用了哪个模型，设置页的默认值还可能被绕过。

## What Changes

- 新增 `stageModels` 设置：剧本 / 角色 / 镜头表 / 提示词四个环节各自绑定一个模型表条目；未绑定则沿用「文本 · 常规」默认。
- 设置页新增「生成环节默认模型」区域，四个下拉只列文本能力（text / textPro）的模型。
- 剧本、镜头表、提示词工作台用真实模型下拉替换 lite/pro 档位；下拉列出全部文本模型，首项显示当前默认解析结果；手选覆盖按环节保存在本地。
- 拆角色使用「角色」环节模型，删除写死的 `model: 'pro'`；角色板新增三视图图像模型下拉（view 能力），手选覆盖沿用现有本地模型选择。
- `/api/text` 的 modelKey 解析同时接受 text 与 textPro 条目；显式传入不存在的 modelKey 返回明确错误，不再静默换成别的模型；响应回传实际解析到的 modelKey 与模型 ID。
- 3D 调度的文本调用跟随「镜头表」环节模型，删除写死的 `model: 'lite'`。
- **BREAKING**（仅内部接口）：`/api/text` 对无效 modelKey 的行为从静默回退改为 400；设置 JSON 新增 `stageModels` 字段。
- 不包含：text / textPro 能力体系重构、按项目保存模型、自动渠道或模型回退、图片/视频环节的通用化选择（角色三视图除外）。

## Capabilities

### New Capabilities

- `stage-model-selection`: 为剧本、角色、镜头表、提示词等生成环节绑定默认模型，允许在环节内手动覆盖，并保证请求使用用户选择且不静默替换模型。

### Modified Capabilities

无。

## Impact

- 代码：`vite.config.ts`（设置类型、正常化、`/api/text` 解析）、`src/api.ts`（Stage / stageModels、响应类型）、`src/Settings.tsx`（环节默认 UI）、`src/ScriptBoard.tsx` / `src/ShotTable.tsx` / `src/PromptTable.tsx`（模型下拉）、`src/App.tsx`（拆角色选择与传递）、`src/CharacterBoard.tsx`（三视图选择）、`src/Inspector.tsx`（提取共享模型下拉）、新增 `src/ModelSelect.tsx`、`src/layoutGen.ts`。
- 数据：SQLite settings 的 JSON 增加 `stageModels`，无 schema 变更；手选覆盖存 localStorage。
- 验证：新增/扩展 Playwright 与接口脚本，覆盖 textPro 条目解析、无效 modelKey 报错、四环节默认与手选、三视图选择。
- 兼容性：没有 `stageModels` 的旧设置按「未绑定 → 文本默认」工作；已有 lite/pro 调用点全部迁移，不再依赖 tier。
