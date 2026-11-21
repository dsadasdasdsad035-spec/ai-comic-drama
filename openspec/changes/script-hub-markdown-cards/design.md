# Design

## Context

- `ScriptBoard.tsx` 已删除；`episodes` 仍存于 `project.json`，写回路径为创意 `submit_episodes`、`EpisodeScriptImportDialog` + `mergeScriptDraft`。
- 画布 `BoardEpisodeGrid` 承担分集卡片、剧本导入、`EpisodeScriptDetailDialog` 只读时间线；`parseScriptMarkdown` 与 `FULL_SCENE_HEADING_RE` 已对齐 short-drama 格式。
- 分镜 MD 已有 `episodeMarkdown`；剧本 MD **尚无** render 函数。
- 路由：`ViewId` 无 `script`；`parseHash` 仅 `#/p/<proj>/<view>` 一级段；集深链需扩展或应用内 state。
- Markdown 预览可复用 `src/chat-ui/ChatText.tsx`（`react-markdown` + GFM）。

## Goals / Non-Goals

**Goals:**

- 左栏 `script` 视图：卡片墙 + 集详情双 tab MD 预览。
- 剧本导入主入口迁至剧本视图；画布仅深链。
- `buildScriptEpisodeMarkdown(ep, opts)` 与 import 往返验收。
- 画布 ↔ 剧本导航与 `epNo` 一致。

**Non-Goals:**

- 场次表单编辑、`scriptDirty`、剧本专用 WorkbenchChat。
- 剧本 zip 批量导出。
- 修改 `parseScriptMarkdown` 格式或分镜表导入规则。

## Decisions

### 1. 路由与深链

**决定**：`ViewId` 增加 `script`；hash 首期 `#/p/<proj>/script`，集详情用 **应用 state** `scriptDetailEpNo`（与今日 `episodeScriptDetailEpNo` 迁移），可选后续增加 `#/p/<proj>/script/E02` 第三段（`parseHash` 扩展，`isViewId` 仍只看 `parts[2]`）。

**备选**：全用 query/hash 段承载集号——可分享深链，但需改 `route.ts` 与 `verify-project-scope`；P0 用 state + `writeLastView` 即可。

**集选择器行为**：剧本**列表**阶段隐藏 `EpPicker`（类似画布集目录）；**详情**阶段显示当前集并允许切换 → 切集时换详情内容。

### 2. 组件拆分

| 组件 | 职责 |
|------|------|
| `ScriptEpisodeHub.tsx` | 卡片墙、工具条、空态；props 镜像 `BoardEpisodeGrid` 的数据需求 |
| `ScriptEpisodeDetail.tsx` | 全页或主区内详情：header chips、tab 剧本/分镜、`ChatText` 预览、复制 MD、进画布 |
| `buildScriptEpisodeMarkdown.ts` | 纯函数，与 `scriptMarkdown.ts` 同目录或 `storyboardMarkdown` 旁新建 `scriptExportMarkdown.ts` |

**卡片复用**：抽 `EpisodeCardShell` 或共享 `listBoardEpisodes` + 样式类；`mode='script' | 'board'` 控制 footer actions（剧本：进详情；画布：进分镜）。

### 3. Markdown 预览 UI

- 包装 `ChatText` 或薄封装 `MarkdownPreview.tsx`，class `script-md-preview`，max-width 阅读宽（~72ch），场次 `h2` 样式与 `theme.css` 中 `ep-script-*` 对齐后逐步废弃对话框样式。
- 「分镜」tab：调用 `episodeMarkdown({ projectName, episodes, shots, style, aspect, logline }, epNo).content`（按现有 API 取字符串）。

### 4. `buildScriptEpisodeMarkdown` 形状

输出：

```text
# EP001 集名

> 钩子（若有，blockquote）

## EP001-SC001 内 · 地点 · 时间

beats 正文原样（不包裹列表）
```

规则：

- 集号、场号零填充与 `formatEpisodeLabel` / 场景 `no` 一致。
- `space` 映射 `内|外|内外`（与 parse 反向）。
- 不嵌入分镜表；分镜表仅在分镜 tab。

往返测试：扩 `verify-script-markdown-import.mjs` 或 `tests/script-markdown-import.ts`。

### 5. 画布收缩

- `BoardEpisodeGrid`：移除 `EpisodeDirToolbar` 剧本导入分组；footer「看剧本」→ `onNavigate('script')` + set detail ep；可删除 `EpisodeScriptDetailDialog` 在画布侧的挂载。
- 单集画布顶栏 `ep-chip-script` 保留，点击同样跳转剧本详情。
- `EpisodeScriptImportDialog` 提升到 `App.tsx`，由剧本视图与（可选）创意入口触发。

### 6. 写回与刷新

导入与 Agent 写回均 `patchProject` → `setEpisodes`；剧本视图订阅同一 state，无需局部草稿。移除/弱化 README 与 `project-context` 中「未保存剧本切换确认」——若代码中已无 `scriptDirty`，验收删除相关断言。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 卡片墙与画布 duplicate | 共享 list/卡片子组件；accept 短期两文件 |
| hash 无集号不可分享链接 | P1 加 `script/E02` 段 |
| `ChatText` 样式偏聊天 | 独立 prose class，不污染聊天 CSS |
| spec 仍写「顶栏剧本」 | archive 时合并 `workbench-shell` 左栏语义 |
| 目标时长编辑两处 | 保留画布/剧本摘要只读，编辑仍在画布单集摘要（已有字段共享） |

## Migration Plan

1. 加 `script` 导航与空壳页，确保路由与 `writeLastView`。
2. 实现 `buildScriptEpisodeMarkdown` + 测试。
3. 上线 `ScriptEpisodeHub` / `Detail`，迁移导入对话框。
4. 瘦身 `BoardEpisodeGrid`，改深链。
5. 更新 README、`verify-script-hub.mjs`（新）、回归 `verify-project-scope.mjs`。

Rollback：feature flag 隐藏 nav 项，恢复画布导入按钮（单 PR revert）。

## Open Questions

- 集详情用**全页**还是**侧栏抽屉**：建议全页（长剧本阅读），与素材详情一致。
- 剧本视图 `新建分集`：画布仍保留「新建分集」时，剧本墙是否同步提供——建议 **是**（写 `episodes` 空壳），与画布 `blankEpisode` 共用回调。