# Tasks

## 1. 渲染内核

- [x] 1.1 新增 `src/storyboardMarkdown.ts`，实现单元格净化（换行→`<br>`、`|`→`｜`）与文件名净化（`E{两位集号}-{标题}.md`，非法字符与连续空白转连字符，空标题退化），并在 `tests/storyboard-markdown.ts` 中断言含非法字符的标题、空标题与多行文本的净化结果；把该测试加入 `verify-skills-unit.mjs` 的 `TESTS`，跑 `node verify-skills-unit.mjs` 通过
- [x] 1.2 实现分镜表的表头与行渲染：列顺序为镜头、场次、时长、景别、运镜、画面与动作、台词与声音、首帧提示词、视频提示词；缺值单元格留空，画面与动作和首帧提示词互不填充。断言覆盖「只有首帧提示词、无画面描述」与「两列都空」两种镜头
- [x] 1.3 实现单集文档章节渲染：项目级标题、唯一一个 `## 第 N 集 <标题>`、场次小节（标题不含集标记）、表格外附注（转场与缺项）。断言导出文本经 `classify.ts` 的 `episodeScopeOf` 判为 `single` 且集号正确、经 `hasShotTable` 命中分镜表、经 `markdownTableBlocks` 只有一块带镜号表头
- [x] 1.4 实现全部集渲染：按集号升序各生成一份文档，集内镜头按镜号数字序排列。断言 3 集输入产出 3 份文本，每份只含对应集号与镜号集合

## 2. 回灌兼容（导入侧）

- [x] 2.1 在 `src/intake/normalize.ts` 的 `splitDialogueCell` 入口加入 `<br>` / `<br/>` / `<br />` → 换行的归一化，并在 `tests/storyboard-markdown.ts` 断言三种写法的分段结果一致；同时断言既有的无 `<br>` 用例（旁白、纯音效、混合内容）结果不变
- [x] 2.2 让场次列真正落库：`src/intake/rows.ts` 把已识别的场次单元格写入 `ImportShotRow.scene_no`，`IntakeDialog` 与 `BundleDialog` 的行映射补传该字段。断言场次号存在时写入对应场次、场次号不存在时回退第一场并计入预览提示、无场次列时不产生场次提示
- [x] 2.3 补一条端到端往返测试：用固定镜头集（含两个说话人的一镜、场次 2 的一镜、已带首帧图与成片的镜头）渲染为 Markdown，再经 `rowsFromTable` → `buildShotsFromImport` → `mergeShotsDraft(import 策略)` 写回，断言文字字段与场次一致、台词仍为两条、`keyframe` 与 `clip` 保持原值未被清空

## 3. 导出入口

- [x] 3.1 实现 zip 打包：用 `fflate` 的 `zipSync` 把各集文件打成 `{项目名}-分镜表.zip` 并触发下载（复用 `src/creative/expertExport.ts` 的 Blob 下载写法）。断言条目名与集号一一对应、项目名经过净化
- [x] 3.2 在画布视图上下文带的动作区追加「导出」，点击即下载当前集；无项目或当前集 0 镜时禁用并用 `title` 说明原因；样式与「导入」同为非强调。验证方式：手动打开画布确认三个状态（正常下载、无项目禁用、0 镜禁用）
- [x] 3.3 在分集目录工具条追加「导出全部」，点击下载全部集 zip；无项目或无任何分集时禁用并说明原因。验证方式：手动打开分集目录确认触发与禁用条件
- [x] 3.4 删除 `src/App.tsx` 中的 `exportJson` 与顶栏「导出 JSON」按钮，`grep -rn "导出 JSON\|storyboard.json"` 在 `src/` 无残留；同步更新 `README.md` 里把「导出 JSON」列进全局带的描述为分镜表导出位于画布与分集目录

## 4. 集成验证

- [x] 4.1 启动应用实测闭环：导出当前集与全部集，把 zip 原样传回导入入口，确认预览按集显示新增/更新镜数、重复导入同一 zip 不产生重复镜头、已出图出片的镜头媒体仍在
- [x] 4.2 跑 `npm run build`（`tsc --noEmit` + `vite build` + 服务端构建）与 `node verify-skills-unit.mjs`，两者均通过

## Workflow follow-up

- Archive the change after review, then verify the archived specs contain the new `storyboard-markdown-export` capability and the modified requirements.
