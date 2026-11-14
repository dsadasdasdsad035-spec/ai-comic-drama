# Design

## Context

设置逻辑集中在 `src/settings/SettingsPage.tsx`（约 2500 行）：扁平 `section` 状态驱动 14 个 `render*`，外壳为 `settings-shell` + `st-nav`（3 项 + 「高级」11 项）+ 固定副标题顶栏 + `st-statusbar`。样式在 `src/theme.css` 的「设置页 2.0」段。深链经 `SettingsInitialSection` 与 `App.tsx` 的 `changeView(..., { settingsSection })`。验收见 `verify-settings-ui-v2.mjs`。

动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 引入 `hub + pane` 两层导航，映射到现有 14 个 section，不改 `AppSettings` 持久化形状。
- 动态顶栏、状态条跳转、管线预览、扩展总览、测试钩子与深链兼容。
- 为后续按枢纽拆文件留出目录边界。

**Non-Goals:**

- 全设置搜索、分区级自动保存、主题「外观」子页、修改计费/模型 API。
- 重做渠道卡/模型表/技能市场内部交互。

## Decisions

### 1. 导航状态：`hub` + `pane` 取代扁平 `section`

- **选择**：`useState` 存 `hub: SettingsHub` 与 `pane: SettingsPane`；`pane` 枚举含全部 legacy section id。
- **理由**：一级仅 5 项，二级 Tab 由枢纽配置表驱动，避免 14 路 `setSection` 分支散落。
- **备选**：保留 `section` 单状态 — 拒绝，无法表达「同一枢纽切换 Tab」时顶栏/状态条过滤。

映射表（实现时集中为 `settingsNav.ts`）：

| hub | panes |
|-----|--------|
| `connections` | `providers`, `models` |
| `pipeline` | `routing`, `lipsync`, `voices` |
| `extensions` | `overview`, `agent`, `creative`, `skills`, `mcp`, `experts`, `stock` |
| `billing` | `pricing`, `billing` |
| `data` | `data` |

`LEGACY_SECTION_TO_NAV: Record<SettingsInitialSection, { hub, pane }>` 供 `initialSection` effect 使用。

### 2. 渲染：pane 仍调用现有 `render*`

- **选择**：`st-scroll` 内 `pane === 'providers' && renderProviders()` 等，逻辑不变。
- **理由**：P0 最小风险；P2 再按 hub 迁文件。
- **备选**：一次拆 5 个 hub 组件 — 推迟到 tasks 后半段。

新增 UI 仅三处：`renderHubTopbarMeta(hub)`、`PipelinePreviewCard`、`ExtensionsOverview`。

### 3. 顶栏与状态条

- **顶栏**：常量 `HUB_COPY[hub] = { title, subtitle }`；主标题 `设置 · ${title}`。
- **状态条**：现有 `missingKeys` / `billing` / `invalidDefaults` 计算不变；芯片 `onClick` 设 `hub+pane` 而非仅 `setSection('providers')`。

### 4. 二级 Tab 组件

- **选择**：`.st-subnav` + `role="tablist"`，`button[role=tab]`，`aria-selected`；根节点 `data-settings-hub` / `data-settings-pane`。
- **理由**：满足 spec 与 Playwright 稳定选择器。
- **扩展枢纽**：7 个子 Tab；窄屏 CSS 延续 `@media (max-width: 980px)` 横滑，必要时 `st-subnav--dense` 缩小字号。

### 5. 管线预览

- **选择**：从 `defaults`、`stageModels`、`models` 解析四条摘要：shot 用 `stageModels.shot`，image/video/audio 用对应 cap 默认；显示 `ModelEntry.label`，缺省时「未绑定」。
- **理由**：只读 `useMemo`，不新 API。
- **位置**：`renderRouting` 顶部插入 `PipelinePreviewCard`。

### 6. 扩展总览

- **选择**：`overview` pane 纯 UI：卡片链 `setPane(...)`；计数来自 `skillRows.length`、MCP/专家面板已有 list 状态（或轻量 `useEffect` 拉已有 API）。
- **理由**：不引入新后端。

### 7. 验收迁移

- `verify-settings-ui-v2.mjs`：优先 `[data-settings-pane="providers"]`、`.st-nav [data-settings-hub="connections"]`；保留一条对「渠道」文案的 smoke，避免回归。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| `SettingsPage` 继续膨胀 | P2 任务拆 `hubs/`；P0 先抽 `settingsNav.ts` + 小组件 |
| 扩展枢纽 7 Tab 窄屏拥挤 | 横滑 + dense 样式；总览作入口减少直接点最后一个 Tab |
| 深链遗漏映射 | 单测或 verify 覆盖 skills/mcp/experts/stock |
| 用户习惯旧侧栏文案 | 五个枢纽中文名旁保留 counts（渠道/模型） |

## Migration Plan

1.  ship P0：导航 + data 属性 + verify 更新（行为等价）。
2.  ship P1：预览卡 + 总览 + 顶栏文案。
3.  可选 P2：文件拆分，无用户可见变更。

回滚：恢复 `SECTION_META` 双列表导航即可，data 属性可保留。

## Open Questions

（无 — 素材库归属已在 proposal 定为扩展枢纽独立 Tab。）