# Design

## Context

见 `proposal.md`。当前 `EpisodeScriptImportDialog` 仅在 `detectFormat` 为 JSON 时零模型；Markdown 剧本落在 `free-text` 并依赖 `runIntake` + `script-intake`。short-drama 生态已在 Python `creator_views.parse_screenplay` / `SCENE_RE` 中实现同等场标题解析，但前端未复用。

## Goals / Non-Goals

**Goals:**

- 分集剧本导入：仅 Markdown → `scriptMarkdown.parse` → `validateContract('script-v1')` → `planScriptImport` → 现有 `onApply`。
- 场标题正则与 short-drama 文档一致（内|外|内外 · 地点 · 时间）。
- `beats` = 场正文原文切片，不做 NLU。
- 合体文件：有场标题则走剧本路径，分镜表计数忽略。

**Non-Goals:**

- 不复刻 short-drama 全套对白块结构化（`blocks` / 时长估算）。
- 资料包 zip 内剧本改判复用解析器（tasks 可选）。
- 画布导入、JSON `submit_episodes`、模型 intake 技能本体不改写规则。

## Decisions

### 1. 解析模块放在 `src/intake/scriptMarkdown.ts`

导出 `parseScriptMarkdown(text, hints?: { epNo?: number })` → `{ episodes: ProjectEpisode[]; warnings: string[] }`。

- **理由**：与 `format.ts`、`rows.ts` 同属 intake 层；`EpisodeScriptImportDialog` 只编排。
- **替代**：调用 Python `creator_views`——运行时要 node 调 python，否决。

### 2. 正则对齐 `creator_markdown_check.py` / `creator_views.SCENE_RE`

TypeScript 移植 `SCENE_RE`：二级 `##` 行（非 `###`）匹配场景 ID、space、地点、时间。一级 `# EP…` 提集标题。

- 场 `no`：`SC` 三位数字解析为整数。
- `slug`：完整场景 ID 字符串（如 `EP001-SC001`），便于与分镜「来源」对齐。

### 3. `format.ts` 增加 `script-markdown` 形态

识别逻辑：**存在至少一行合法 short-drama 场标题** → `script-markdown`，即使文中还有分镜表。

- `EpisodeScriptImportDialog` 在 `script-markdown` 时调用解析器，不再看 `markdown-table`。
- `IntakeDialog`（画布）行为不变，仍优先镜号表。

### 4. 收紧 `EpisodeScriptImportDialog` 文件类型

- `accept` 仅 `.md,.markdown`；去掉 organize 按钮与模型相关 state（`organized`、`runIntake`）。
- 粘贴区 placeholder 写明场标题示例。
- **BREAKING**：去掉 JSON 直通 UI；Agent 写回不受影响。

### 5. 校验与错误

- 解析后 `validateContract('script-v1')`；失败时展示契约错误列表，不写部分集。
- 空 `episodes` 或零场次 → 与规格一致的单条用户可读原因。

## Risks / Trade-offs

- **[Risk] 作者使用 `###` 写场标题** → 解析失败；Mitigation：错误文案链到 short-drama 文档示例，单测覆盖正反例。
- **[Risk] 一文件多集（多个 `# EP00x`）** → 本期按场景 ID 的 `EP` 归集；无 `EP` 前缀的杂稿靠 `hintEpNo` 兜底，预览提示置信度。
- **[Risk] `beats` 极长** → 与现有项目 POST 上限一致；超限时整次拒绝并提示拆文件。
- **[Trade-off]** 去掉 JSON 导入后，手粘 `script-v1` 需走 Agent 或先存为 md——符合产品取舍。

## Migration Plan

- 部署后即生效，无数据迁移。
- 回滚：恢复对话框对 JSON/模型路径即可；已导入的 `episodes` 数据不受影响。

## Open Questions

（无——场次语法、仅 Markdown、合体文件忽略分镜表已在探索中确认。）