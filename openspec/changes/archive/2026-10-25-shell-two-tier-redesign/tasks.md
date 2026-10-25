# Tasks

## 1. 上沿表面 token

- [x] 1.1 在 `src/theme.css` 的 `:root` 与 `html[data-theme='day']` 各新增字面值 token `--chrome-1`、`--chrome-2`、`--chrome-line`（暗色取 `--panel-2`/`--panel` 附近，日间取比内容更亮的暖白），并验证 `node verify-style.mjs` 通过：token 全部解析、无自引用、对比度达标
- [x] 1.2 同步更新 `STYLE-GUIDE.md` 的表面 token 表，加入三行 chrome token 与用途，验证文档中的每个 token 都能在 `src/theme.css` 搜到定义

## 2. 全局带固定化

- [x] 2.1 把 `src/App.tsx` 的 `<header className="topbar">` 改为固定成分顺序（品牌 → 项目 → 集 → 导航 → 密钥告警 → 任务 → 主题 → 导出），删除按 `view` 分支的 `ToolMenu`、`BoardMenu`、`+ 素材`、`▶ 连播` 与右侧状态槽（`board-count` 分支），验证 `npm run build` 通过且七个视图下 header 的 DOM 结构一致
- [x] 2.2 新增画布内浮动工具条（`.canvas-tools`，画布左上，`z-index` 介于 React Flow 控件与 `.ctx-menu` 之间）承载标注、操作、+ 素材、连播，验证画布视图四项都可用、其他视图不出现该工具条
- [x] 2.3 把 `.topbar` 高度改为 52px 并改用 `--chrome-1`/`--chrome-line`，验证日间与夜间下上沿与内容有可见边界、`node verify-style.mjs` 仍通过
- [x] 2.4 更新 `README.md` 中关于顶栏与集栏的描述（项目上下文、主题两节），验证文字不再提到已删除的集栏横条与导出主按钮

## 3. 集选择器

- [x] 3.1 把 `src/EpisodeBar.tsx` 改写为弹出选择器：触发器显示 `E01 标题 · N 镜`，展开后为带镜数的胶囊列表；触发器用 `epbar-trigger`、列表项保留 `epbar-tab`，验证点击可切换集、当前项高亮
- [x] 3.2 让集选择器在画布、剧本、角色、素材、镜头表、提示词六个视图都出现（`App.tsx` 的渲染条件加入 `chars`），验证角色页切集后镜头上下文与聊天上下文都指向新集
- [x] 3.3 为触发器补 `aria-haspopup="listbox"`、`aria-expanded`，列表补 `role="listbox"`/`option`/`aria-selected`，实现方向键、Home/End、Enter、Esc 与关闭后焦点归还，验证只用键盘可完成一次切集
- [x] 3.4 无集或无项目时显示未选状态且不伪造集号，验证新建空项目下触发器显示未选且展开列表为空提示

## 4. 视图上下文带组件

- [x] 4.1 新建 `src/WorkbenchBar.tsx`，提供范围/设置/动作三个命名槽位，样式落在 `.wb-bar` 并保留 `.wb-field`、`.btn`、`.btn-ghost` 约定，验证只渲染传入槽位且空槽不占位
- [x] 4.2 在 `src/theme.css` 合并重复定义的两份 `.wb-bar`/`.wb-foot`（2622 与 2844 行附近），高度改为 44px，给 `.wb-field .label` 加 `white-space: nowrap`，验证 `node verify-style.mjs` 通过且标签不再逐字换行

## 5. 各视图接入上下文带

- [x] 5.1 镜头表接入 `WorkbenchBar`（范围=镜头表 · E01 · N 镜；设置=目标时长、模型；动作=助手、重新加载），保留页脚的保存与生成到画布，验证 `verify-project.mjs` 中 `.wb-foot` 断言仍通过
- [x] 5.2 提示词接入 `WorkbenchBar`（范围=提示词 · E01 · N 镜；设置=模型、每批；动作=助手、重新加载），保留页脚的补齐锚点、生成提示词、保存、推到画布，验证 `verify-prompt-3d-workbench.mjs` 的 `.wb-foot button` 定位仍通过
- [x] 5.3 剧本页把集数、每集秒、模型与生成/保存/重新加载收进上沿或范围槽，删除 `.sb-actions` 中的重复排布，验证剧本页上沿只有一条上下文带且生成分集是唯一强调按钮
- [x] 5.4 角色页把 `.board-head`、`.board-models` 合并进 `WorkbenchBar`（范围槽沿用 `board-hint` 类并显示 `角色 · E01 · N 个 · 当前镜头 SN`），主强调按钮按空板/有未注入设定切换，验证 `verify-chars.mjs` 仍能读到 `.board-hint` 文本
- [x] 5.5 素材页同样合并头部与模型行（范围=素材 · E01 · 场景 N · 道具 N · N 张有图），主强调按钮按空板/有图切换，验证场景/道具页签与「全部加入画布」都可用
- [x] 5.6 把角色/素材的长说明改为空板时的一行可关闭提示（组件内 `useState`，不写 localStorage），验证有卡片时不渲染该提示、关闭后本次会话不再出现

## 6. 主操作与聊天头部

- [x] 6.1 把导出 JSON、主题切换、任务中心、重新加载改为非强调样式，验证七个视图中强调样式按钮每屏最多一个
- [x] 6.2 把 `src/chat-ui/WorkbenchHeader.tsx` 的范围 chip 改为范围词（全剧/本集/当前镜头），各工作台的 `scope()` 不再返回集号，验证聊天头部不出现「第 N 集」

## 7. 响应式与无障碍

- [x] 7.1 给 Row 1 加显式断点：≥1400 全量、1280–1400 隐藏品牌副标题与集标题只留集号、<1180 有意折成两行（补 `row-gap` 与 `min-height`），验证 1440 与 1200 两个宽度下都无逐字换行或控件重叠
- [x] 7.2 给 `WorkbenchBar` 加 `ResizeObserver` 量自身宽度并写 `data-density`（wide/narrow/tight），窄列时依次收起范围细节、可选说明与设置槽；不用 `container-type`，避免 `.board` 内 `position: fixed` 抽屉被改锚。验证：1300px 宽打开聊天后密度降为 narrow、上下文带仍是 44px 且不换行
- [x] 7.3 集选择器弹层 portal 到 `body` + `position: fixed`（Row 1 窄屏折行时没有稳定的相对定位参考）；画布工具的 `操作` 面板改左对齐并加 `max-width: calc(100vw - 32px)`，验证 760/1000/1600 三个宽度下弹层都完整落在视口内
- [x] 7.4 给视图导航加 `aria-current="page"` 与 `aria-label="工作台视图"`，验证屏幕阅读器语义与 Tab 顺序与视觉顺序一致

## 8. 校验脚本与证据

- [x] 8.1 更新 `verify-3d-render-asset-flow.mjs` 与 `verify-workbench-chats.mjs` 的切集步骤为先点 `.epbar-trigger` 再点 `.epbar-tab`，验证两个脚本通过
- [x] 8.2 跑冒烟四件套 `verify-workbench-chat-ui.mjs`、`verify-shot-inspector.mjs`、`verify-project.mjs`、`verify-chars.mjs`，全部通过
- [x] 8.3 重拍上沿证据截图：画布、镜头表、提示词、角色、素材各日夜一张，存入 `openspec/changes/shell-two-tier-redesign/evidence/`，验证截图里上沿只有两条带、无重复项目/集号

## Workflow follow-up

- 实现与验证完成后，用 `/opsx:apply` 执行本清单，再用 `openspec archive shell-two-tier-redesign` 归档；归档前先 `openspec-sync-specs` 把 `workbench-shell` 与 `theme-switching` 的增量同步进主规格。
