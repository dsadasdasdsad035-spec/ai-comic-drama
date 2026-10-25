# Tasks

## 1. 修正文颜色

- [x] 1.1 把 `src/theme.css` 中 `.creative-empty p` 与 `.creative-empty-hint` 的文字色从 `var(--muted)` 改为 `var(--text-2)`，并在创意区块加注释：在 `.chat-ui` 子树内渲染的规则，文字色只用 `--text` / `--text-2` / `--muted-foreground`。验证：日间与夜间下空态两段正文的计算色不再是背景色
- [x] 1.2 用脚本量空态标题、说明、提示与示例文字在两套主题下对实际背景的对比度，验证全部 ≥ 4.5:1；同时确认 `node verify-style.mjs` 仍通过

## 2. 三列骨架与产物栏

- [x] 2.1 把 `creative-main` 拆成 `creative-body`（横向）内的 `creative-conversation` 与 `CreativeArtifacts` 新组件（320px），`CreativeCards` 从 `ChatThreadShell` 上方移到产物栏内，产物栏根节点加 `chat-ui` class。验证：有源视频时对话可视高度与无产物时相同，产物卡片的 Card/Badge 视觉与聊天区一致
- [x] 2.2 给产物栏加折叠按钮（可达名称「折叠产物」/「展开产物」），状态存 `localStorage['creative:artifacts:open']`，折叠后该列从可访问树移除。验证：折叠后对话列占满剩余宽度、消息与滚动位置不变，刷新后折叠状态保持
- [x] 2.3 没有源视频、产物与生成结果时不渲染产物栏。验证：新建空会话下 DOM 中不存在产物栏元素，对话框占满整行
- [x] 2.4 `<1280px` 把产物栏改为覆盖式抽屉（与 980px 会话列表同模式），对话列始终 ≥560px；Esc 关闭并把焦点还给折叠按钮。验证：1280 与 1100 两个宽度下产物栏不压缩对话列、抽屉可键盘关闭

## 3. 阅读宽度与头部密度

- [x] 3.1 在 `.creative-conversation` 内把消息视口与 composer 内容限制为 `max-width: 640px; margin-inline: auto`，不动 `ChatMessage` / `ChatViewport` 的公共样式。验证：1500px 视口下助手段落与输入框渲染宽度都 ≤640px 且左右留白对称，另外七个工作台的聊天宽度不变
- [x] 3.2 把 `[data-creative-context]` 那行改为单行不换行 + 溢出省略，模型显示短名（优先 `m.model`，退回 `key`），完整值放 `title`。验证：长模型名下头部高度不增加，`[data-creative-header]` 高度稳定在 55px

## 4. 模式化媒体条与示例去重

- [x] 4.1 策划模式下不挂载 `CreativeComposerBar`（整条不渲染，不是禁用）。验证：策划模式下 DOM 中不存在 `[data-creative-composer-bar]`，反推/复刻模式下存在
- [x] 4.2 反推/复刻模式保留摄取行，无源视频时切分与抽帧禁用、有源视频时显示镜头数并可用。验证：`verify-creative-e2e.mjs` 的空态上传入口仍可用，摄取行四种状态可断言
- [x] 4.3 删除 `CreativeEmpty` 的静态示例列表（`creative-empty-tips`），保留 `creative-empty-hint` 与输入框上方可点击的 `[data-chat-suggestion]`。验证：空态只存在一组示例且点击只填输入框、不发送；`verify-creative-ui.mjs` 的示例计数断言仍成立
- [x] 4.4 移除 `CreativeComposerBar` 末尾重复的模式标签，模式只由 `[data-creative-modes]` 表达。验证：界面中模式文字只出现在模式切换器上

## 5. 会话列表密度与导航稳定

- [x] 5.1 会话行改为两行：标题（可用宽度 ≥150px）+ `模式 · 相对时间`（由 `updatedAt` 计算，超过 7 天显示日期）。验证：三个未命名会话时每行仍可区分，标题截断处有 `title` 完整值
- [x] 5.2 改名与删除收进行尾 `⋯` 入口，默认不可见但保留占位（`:hover` 与 `:focus-within` 时显示），菜单项可键盘操作。验证：Tab 到会话行时入口可见可聚焦，改名与删除仍可用；`verify-creative-ui.mjs` 的四个列表动作断言通过
- [x] 5.3 创意视图继续隐藏项目与集选择器，但保留其占位几何：包装容器 `visibility: hidden` + `aria-hidden` + `inert`。验证：从镜头表记录导航 x 坐标，切到创意再切回，偏移 ≤2px；Tab 顺序不会停在隐藏的选择器上

## 6. 校验脚本与证据

- [x] 6.1 更新 `verify-creative-ui.mjs`：产物宿主位置改为产物栏、示例计数改用 chips、窄屏断言覆盖产物栏抽屉，并新增导航位置稳定与对比度断言。验证：脚本通过
- [x] 6.2 更新 `verify-creative-e2e.mjs`、`verify-creative-reverse.mjs`、`verify-creative-export.mjs` 中依赖产物横带位置的选择器，指向产物栏内的同名钩子。验证：三个脚本通过，产物卡的动作按钮仍可触发
- [x] 6.3 重拍创意视图证据截图：1500 / 1280 / 900 三个宽度 × 日夜各一张，存入 `openspec/changes/creative-layout-rework/evidence/`。验证：截图里对话列宽度一致、产物在右栏、策划模式无媒体条、空态文字可见

## Workflow follow-up

- 实现与验证完成后运行 `/opsx:apply` 执行本清单，再 `openspec-sync-specs` 把 `creative-layout` 增量同步进主规格，最后 `openspec archive creative-layout-rework`。
