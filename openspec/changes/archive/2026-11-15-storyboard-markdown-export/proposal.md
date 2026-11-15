# Proposal

## Why

系统目前唯一的「导出」是顶栏的「导出 JSON」：它导的是画布节点快照（含坐标、标注，标题硬编码为「回收人 · 分镜」），不是项目里的镜头数据。而画布节点上根本没有 `desc`（画面与动作）——该字段只存在于 `project.json`，所以从画布导出必然丢失画面描述，导出的文件也无法再导入回来。用户因此既拿不到可交付的分镜文档，也拿不到可回灌的项目快照。

导入侧其实已经把 Markdown 契约定死了（表头首列必须是「镜头」、`## 第 N 集` 是集边界、台词单元格用 `说话人：文本`）。导出只要按同一份契约反向渲染，就能免费得到「导出 → 编辑 → 导入」的闭环，而不必新增第二套格式。

## What Changes

- 新增分镜表 Markdown 导出：每集一个 `.md` 文件，内含集标题与钩子、场次小节、一张分镜表、表格外附注（转场与缺项）。
- 导出范围：当前集导出单个 `.md`；「全部集」按集各出一个 `.md` 并打包为 zip，使每个文件都是单集文件、都能直接被现有压缩包导入路径写回对应集。
- **BREAKING**: 移除顶栏的「导出 JSON」。它导出的是画布节点快照，与项目镜头数据无关，且标题写死为其他项目名。
- 画布视图上下文带的动作区新增「导出」（当前集）；分集目录的工具条新增「导出全部」（zip）。
- 单元格净化：换行渲染为 `<br>`，竖线渲染为全角 `｜`，保证一张表能装下多行台词与提示词而不打断表格。
- 导入侧两处纯增量扩展，让导出真正可无损回灌：`splitDialogueCell` 先把 `<br>` 归一为换行；场次列的值写入镜头行并透传到导入对话框。
- 明确不做的事：不导出节点坐标、标注、`handEdited`、`orphan` 等工程态；不生成 `index.md` 之类的包说明文件（会被压缩包导入判为「待判断」，增加人工决策噪音）。

## Capabilities

### New Capabilities

- `storyboard-markdown-export`: 分镜表 Markdown 的导出契约（文件切分、章节结构、列与单元格规则、回灌兼容性）与导出入口在画布与分集目录的位置。

### Modified Capabilities

- `workbench-text-intake`: 台词单元格新增 `<br>` 换行归一化；场次列从「只用于统计回退」改为真正写入镜头场次，使既有的「场次号对不上」预览名副其实。
- `canvas-shots-workbench`: 画布动作区新增「导出当前集」，并明确该动作与其他动作的可用条件。
- `workbench-shell`: 全局带移除分镜导出动作，明确分镜表导出属于视图内工具；画布的「导出」不是强调操作。

## Impact

- 前端新增纯函数模块（渲染、单元格净化、文件名净化、zip 打包），复用 `src/creative/expertExport.ts` 里已有的 `zipSync` + Blob 下载套路。
- 修改 `src/board/BoardEpisodeGrid.tsx`（分集目录工具条）、`src/App.tsx`（画布动作区、删除旧 `exportJson`）。
- 修改 `src/intake/normalize.ts`、`src/intake/rows.ts`、`src/intake/IntakeDialog.tsx`、`src/intake/BundleDialog.tsx`（`<br>` 与场次透传）。
- 不影响项目文件格式、数据库、出图出片链路与 Agent 工具契约；导出只读 `episodes` 与 `projectShots`，不读画布节点。
