# Tasks

## 1. Tailwind / shadcn 基础设施

- [x] 1.1 增加 Tailwind v4 Vite 插件、`clsx`、`tailwind-merge`、`class-variance-authority` 和所需 Radix/shadcn 依赖；配置 `components.json`、`@/*` alias；验证：`npm install`、`npx tsc --noEmit` 通过。
- [x] 1.2 新增 `src/chat-ui/chat.css`：只引入 Tailwind theme/utilities，加 `.chat-ui` scoped reset 和 shadcn token 映射；验证：构建后主应用其他页面无 preflight 样式回归。
- [x] 1.3 建立 `src/chat-ui/index.ts` 和 `ui/` primitives（Button、Textarea、Card、Badge、Separator、Tooltip），不引入 ScrollArea 替换 assistant-ui viewport；验证：组件在聊天子树外不产生全局样式。

## 2. 聊天组件迁移

- [x] 2.1 新增 `ChatRoot`、`ChatViewport`、`ChatMessage`、`ChatStep`、`ChatEmpty`、`ChatComposer`，提供稳定 `data-chat-*` 钩子；验证：组件可在测试页/聊天面板单独渲染。
- [x] 2.2 将代码、沙箱、抓帧、验收清单和结束卡片迁移到 `src/chat-ui/tools/`，保留现有状态/结果文案；验证：工具卡在 mock 聊天中全部出现且顺序不变。
- [x] 2.3 改造 `SceneAgentChat`：保留 assistant-ui runtime、事件处理和 `makeAssistantToolUI`，JSX 改用 `chat-ui` 组件；验证：发送、工具卡、帧、清单、取消仍工作。
- [x] 2.4 保留页签切换/滚动恢复/超时和取消行为，迁移 `.cw-agent-viewport` 相关逻辑到新结构；验证：现有聊天 UI/失败取消测试通过。
- [x] 2.5 删除 `theme.css` 中旧 `.cw-agent*` 样式，更新 Playwright 选择器到 `data-chat-*`/role；验证：`rg "cw-agent"` 不残留聊天实现，测试全绿。
- [x] 2.6 更新 README 的聊天 UI 架构：assistant-ui runtime、`src/chat-ui`、Tailwind/shadcn 作用域和主题映射；验证：文档与目录/命令一致。

## 3. 视觉与集成

- [x] 3.1 扩展 `verify-agent-chat-ui.mjs`：日夜主题、900/760px、焦点、工具卡/帧/清单截图；验证：截图无横向溢出且内容可读。
- [x] 3.2 运行 `npm run build`、`npx tsc --noEmit`，比较聊天 chunk 和主 CSS 体积，确认聊天 CSS 随懒加载 chunk 加载；验证：构建通过且主应用未被聊天 utilities 膨胀。
- [x] 3.3 运行 `verify-agent-chat-ui.mjs`、`verify-agent-chat-failure.mjs`，确认视觉迁移没有改变聊天行为；验证：两个脚本全部通过。
- [x] 3.4 回归 `verify-code-workbench.mjs`、`verify-code-sandbox.mjs`、`verify-theme.mjs`，确认 Tailwind/shadcn 没有污染工作台、沙箱和主题；验证：回归脚本全部通过。

## Workflow follow-up

- 归档前确认旧 `.cw-agent*` 已移除、聊天视觉截图已保存，并同步 `chat-ui-design-system` 主 spec。
