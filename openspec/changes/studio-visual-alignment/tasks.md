# Tasks

## 1. 顶部带与导航行

- [x] 1.1 在 `studioStyleText()` 增加侧栏顶部带规则（`logoRow` 高度 44px、padding 8px）与导航行规则（`panelRow` min-height 30px、line-height 18px，并通过 `--dsh-sidebar-row-padding: 9px` 对齐留白）；验证：`node tests/studio-boot-overlay.mjs` 通过，且在真实浏览器中顶部不再出现约 60px 空白带
- [x] 1.2 在注入样式用例中断言规则存在（`_logoRow_` 与 `_panelRow_` 两条选择器及其取值）；验证：删除任一规则后该用例失败，恢复后通过
- [x] 1.3 在 `docs/creative-host.md` 记录这两条尺度规则的范围与回滚方式（删除规则即恢复宿主默认）；验证：文档中的命令可原样执行，说明与 `studioStyleText()` 现状一致

## 2. 字号

- [x] 2.1 增加 `body { --dsh-content-font-size: 13px !important }` 与侧栏根节点 13px；验证：DevTools 计算样式显示对话正文与侧栏导航均为 13px，宿主设置里的字号偏好不再改变结果
- [x] 2.2 覆盖会话列表硬编码标题（`_title_` / `_searchResultTitle_` / `_renameInput_`）为 13px、行高 18px；验证：侧栏导航行与会话列表行字号一致，无"导航小、会话大"的混排
- [x] 2.3 扩展 1.2 的注入文本断言，包含字号三条规则；验证：移除任一规则时用例失败
- [x] 2.4 在 `docs/creative-host.md` 写明应用字号覆盖宿主偏好的理由（外观行已隐藏，应用是尺度的唯一决定者）；验证：说明与 `hideHostAppearanceRow` 的现状一致

## 3. 集成验收

- [x] 3.1 真实浏览器人工验收：1440 宽（侧栏展开/折叠）× 1000 宽（宿主自动折叠断点附近）× 日间/夜间，检查顶部带、导航行高与字号一致；验证：人工清单逐项通过，无布局破图或控件丢失
- [x] 3.2 运行 `npm run test:studio` 全量；验证：命令退出码为 0，既有宿主、预热、常驻与遮罩用例无回归

## Workflow follow-up

- 评审通过后归档 change，确认 `creative-layout` 的新要求合并进 `openspec/specs/creative-layout/spec.md`。
