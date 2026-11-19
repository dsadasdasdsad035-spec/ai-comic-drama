# Tasks

## 1. 注入样式

- [x] 1.1 在 `src/creative/StudioFrame.tsx` 的 `studioStyleText()` 追加 `[class*="_brandMark"]`、`[class*="_railMark"]`、`[data-home-whale]` 三条隐藏规则，并对展开态品牌按钮加 `pointer-events: none`；验证：`node tests/studio-shell.mjs` 中降噪用例断言这三条选择器存在且全部通过
- [x] 1.2 追加折叠轨道规则让面板图标常驻，验证：同一用例断言 `_panelIcon` 常驻规则存在，且侧栏行高相关规则未被改动
- [x] 1.3 更新 `studioStyleText()` 的 JSDoc 与内联注释，说明品牌降噪覆盖的五类目标与「只做减法」约束；验证：注释与实际规则逐条对应，无描述残留
- [x] 1.4 扩展 `tests/studio-shell.mjs` 的「降噪只做减法」用例：新增三条选择器断言，保留既有的 `_buildVersion`/`_localBuildBrand`/`_brandName`/`_fish` 断言与「无背景图、无 content 文案」反向断言；验证：`node tests/studio-shell.mjs` 全绿

## 2. 验收

- [x] 2.1 跑完整创意外壳用例 `node tests/studio-shell.mjs`，验证无失败项
- [x] 2.2 本地起应用（`npm run dev`）并用浏览器打开创意视图，肉眼确认：展开侧栏顶部无鲸鱼标记、点击该位置无反应、行高与折叠按钮位置未变；折叠侧栏顶部显示面板图标且可点；新会话首页无鲸鱼与像素鲸水印

## 3. 去掉预览版说明

- [x] 3.1 在 `server/studio-profile.mjs` 写入 `ui-settings-general` 的 `welcomeNoticeVersion`（值为宿主 `WELCOME_NOTICE_VERSION`），验证：`node tests/studio-model-routing.mjs` 断言 patch 里存在该确认位且值一致
- [x] 3.2 加一条版本漂移守卫：宿主开启版本 bump 时用例失败并提示同步确认值，验证：`node tests/studio-model-routing.mjs` 的「确认版本与宿主源码一致」用例通过
- [x] 3.3 本地起应用并用浏览器打开 `/studio/`，确认首次进入无遮罩弹窗、`#root` 不是 inert、页面文本无「预览版说明」
- [x] 3.4 在 `studioStyleText()` 追加 `[class*="_previewBadge"]` 隐藏规则，验证：`node tests/studio-shell.mjs` 的「降噪只做减法」用例断言该选择器存在，浏览器里该节点 `display: none`

## Workflow follow-up

- 归档前按项目评审要求复查 `openspec/specs/creative-layout/spec.md` 的归档结果。
- 用 `/opsx-archive` 归档本变更。
