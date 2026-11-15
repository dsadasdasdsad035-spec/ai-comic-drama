# 分镜导入保真

## Why

导出现在会写出选角、表演、运镜参照与参考四列，但表格导入只认九列：这些列回来会被判为未识别列，表演还有被 `neutral/3/speaks:true` 占位值覆盖的风险，往返一次就把真实表演改成了假数据、把运镜参照整列丢掉。

## What Changes

- 表头别名表新增 `选角`、`表演`、`运镜参照`、`参考` 四列，并在导入预览里作为已识别列展示，不再落入「忽略的列」。
- 导入行结构扩出 `cast`、`performance`、`dialogue_delivery`、`lexicon_ref_key`、`reference` 五个字段，解析复用导出侧同一份单元格语法。
- 台词列解析新增内联标注：`角色[情绪/强度/语速/音量]{强调}：台词` 里的标注回填为台词表演，且 MUST NOT 进入台词文本。
- `运镜参照` 列按中文名或 `key` 解析为条目 key，只写 `lexicon_ref_key`：
  - MUST NOT 在导入时导入视频文件，MUST NOT 逐个文件落盘；视频地址在生成时按既有解析规则取。
  - 解析不到条目 MUST 在预览里逐条点名并留空该字段，MUST NOT 猜测条目。
- 参考列按名字解析为当前项目的 `refIds`：角色按角色名，素材按素材标题；解析不到的目标 MUST 在预览里逐条点名并跳过，MUST NOT 写入猜测的 id。
- 导入预览区分「文件里写的表演」与「系统补的默认表演」；补默认的行 MUST 单独计数并可见，MUST NOT 让人误以为表演来自文件。
- 新列缺省时不改变既有行为：没有这些列的文件仍按九列语义导入，不产生表演、参考、选角或运镜参照。
- 写入仍走 `import` 字段策略；本次不放开产线字段。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `workbench-text-intake`: 表头别名集合、行字段、台词列解析与导入预览的要求发生变化。

## Impact

- 代码：`src/intake/tableMap.ts`、`src/intake/rows.ts`、`src/intake/diff.ts`、`src/intake/IntakeDialog.tsx`、`src/intake/BundleDialog.tsx`、`src/agent/shotDraft.ts`（解析侧），以及导出侧建立的共享语法模块。
- 依赖：需要 `storyboard-export-fidelity` 先落地单元格语法；`运镜参照` 列依赖 `ProjectShot.lexicon_ref_key`（由 `pi-agent-material-tools` 落地）。两者分别可独立发布，但导入不重新定义语法。
- 规格：`openspec/specs/workbench-text-intake/spec.md` 需同步列识别、台词列与预览语义。
- 不涉及服务端接口与数据模型；`import` 策略白名单不扩容。
