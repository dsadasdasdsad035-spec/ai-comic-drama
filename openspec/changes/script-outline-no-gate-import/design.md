# Design

## Context

见 `proposal.md`。`parseScriptMarkdown` 当前对非 short-drama `##` 返回 `ok: false`；`EpisodeScriptImportDialog` 依赖 `hasScriptSceneHeading` 才识别为 `script-markdown`，`episodesFromScriptJson` 在契约失败时 `blocked`。产品取向：导入是粗灌原料，规范化交给创意 Agent 与导出往返。

## Goals / Non-Goals

**Goals:**

- 单通道 `parseScriptMarkdown`：非空输入 → `{ ok: true, episodes, warnings }`（仅空输入 → `ok: false`）。
- 严格场标题分支保留（与 `buildScriptEpisodeMarkdown` / short-drama 往返）。
- 宽松分支：`##` 切场、启发式 `·` 分段、顺序生成 `EP{ep}-SC{n}` slug；无场 → 单集单场兜底（`hintEpNo`）。
- `normalizeEpisodesForImport`：保证 `script-v1` 可落库字段，占位不挡 UI。
- `format.ts`：`intake: 'script'` 且非空 → 始终走剧本解析。
- 对话框：`.txt` accept、`blocked` 仅写盘错误；warnings 不 disable 确认。

**Non-Goals:**

- 画布分镜导入门禁、Agent `submit_episodes`、Python short-drama 校验栈。
- 单文件同时写分镜（合体 C）。
- 剧本详情 Markdown 编辑器行为变更。

## Decisions

### 1. 合并 strict + lenient 于同一函数

- **做法**：`parseScriptMarkdown` 内先尝试行级严格解析；遇非致命不合规行转入宽松状态机，不返回整份错误。
- **替代**：独立 `parseLenient` 由对话框选择——增加分支，与「零门禁」相悖。

### 2. 导入路径绕过 `validateContract` 挡 UI

- **做法**：新增 `episodesFromScriptImport(parsed.episodes)`（或 flags）仅做 normalize（slug/place/time/beats 字符串），throw 只用于 truly empty episodes。
- **替代**：放宽 `script-v1` schema 全局——影响 Agent 写回质量。

### 3. `detectFormat` 剧本分支

- **做法**：`scriptIntake && raw.trim()` → `{ kind: 'script-markdown', reason: '分集剧本文本' }`；不再要求 `hasScriptSceneHeading`。
- **画布**：不变。

### 4. 启发式场标题

- 认 `内|外|内外|内景|外景|INT|EXT`；`·`/空格分段；缺段用占位。
- 任意 `##`（非表格分隔）开新场；`###` 在本期不单独提升为场界（避免误伤字幕），除非全文无 `##` 再考虑后续迭代。

### 5. 测试与文档

- 扩展 `tests/script-markdown-import.ts`：杂稿、无场、畸形 `##`、strict 样本仍绿。
- README「分集剧本」段：宽进 + Agent 后修，short-drama 为推荐导出格式。

## Risks / Trade-offs

- **[Risk] 占位 slug 与分镜「来源」场景 ID 对不齐** → Mitigation：warnings；Agent 改稿；再导出得规范 Markdown。
- **[Risk] 误把 Markdown 表格行当场标题** → Mitigation：`|` 开头行跳过；现有 `countShotTables` 警告保留。
- **[Trade-off]** 与已交付 `script-episode-markdown-import` 规格意图相反——本 change 在 delta 中显式覆盖。

## Migration Plan

- 部署即生效；已存 `episodes` 不变。
- 回滚：恢复 `parseScriptMarkdown` fail-fast 与对话框 `blocked` 逻辑。

## Open Questions

（无）