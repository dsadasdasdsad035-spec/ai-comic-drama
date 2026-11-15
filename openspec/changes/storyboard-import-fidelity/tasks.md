# Tasks

## 1. 表头与行结构

- [x] 1.1 `src/intake/tableMap.ts` 的 `ShotColumn` 枚举与 `ALIASES` 增加 `cast`、`performance`、`lexicon_ref_key`、`reference`；验证：`verify-intake-fidelity.mjs` 断言四类中文表头都能识别为该列
- [x] 1.2 别名表覆盖导出侧写出的表头写法「选角 / 表演 / 运镜参照 / 参考」，并接受常见变体（出场角色、镜头语言、素材参考、角色参考）；验证：脚本对每种写法断言 `columnOf` 返回预期列
- [x] 1.3 `src/intake/diff.ts` 的 `ImportShotRow` 增加 `cast`、`performance`、`dialogue_delivery`、`lexicon_ref_key`、`reference` 五个字段（与 `ProjectShot` 同名，合并时不必再翻译一层）；验证：`npx tsc --noEmit` 无错
- [x] 1.4 `src/intake/rows.ts` 的 `rowsFromTable` 解析四个新列，缺列时对应字段为 `undefined`（不是空数组）；验证：九列旧文件断言四个字段均未创建

## 2. 单元格解析

- [x] 2.1 在 `src/shotCellSyntax.ts` 复用导出侧语法，实现台词标注解析：只解析说话人之后、首个冒号之前的部分；验证：脚本覆盖完整标注、部分空槽、无标注、冒号后方括号四种情形
- [x] 2.2 实现表演列解析（`角色:情绪/强度/动作/视线/是否说话`，末端槽位缺项留空，`<br>` 分隔多条）；验证：脚本覆盖单条、多条、全空槽、`说`、`不说` 五种情形
- [x] 2.3 实现选角列解析（`、` 分隔、去重保序）与参考列解析（`角色:...;素材:...`、半角与全角分隔符）；验证：脚本覆盖双类、单类、重复项、空值、全角空格五种情形
- [x] 2.4 空槽 MUST 解析为未设置而不是零值或默认情绪；验证：脚本断言 `[/4///]` 的强度为 4 且情绪为 `undefined`

## 3. 台词表演下标一致性

- [x] 3.1 台词被写入时按文件整体重建 `dialogue_delivery`，未带标注的行留空对象；验证：脚本断言「原有两条带表演 → 导入一条无标注」后表演数组长度与台词一致且旧的 `angry` 不再残留
- [x] 3.2 没有台词列时不触碰 `dialogue` 与 `dialogue_delivery`；验证：只给首帧提示词的文件，断言既有台词与表演原样保留、提示词被写入

## 4. 合并策略与落库

- [x] 4.1 `src/shotSync.ts` 的 `SHOT_IMPORT_FIELDS` 增加 `cast`、`performance`、`dialogue_delivery`、`refIds`、`lexicon_ref_key`；验证：`verify-intake-fidelity.mjs` 在 `import` 策略下断言五个字段落库
- [x] 4.2 保持 `SHOT_PIPELINE_FIELDS` 与导入白名单无交集；验证：脚本断言两集合交集为空
- [x] 4.3 `buildShotsFromImport` 区分「文件写的表演」与「系统补的默认表演」，补全按镜计数；验证：脚本断言说话角色都有表演条目时不产生补全计数，某说话角色表演单元格为空时仍计入补全并点名到镜与人

## 5. 参考与运镜参照解析

- [x] 5.1 参考列按角色名与素材标题精确匹配（去首尾空白与全角空格），增补写入 `refIds`，不移除既有连线；验证：脚本断言目标写入，且合并后既有 `char-c9` 仍在
- [x] 5.2 解析不到的角色名与素材标题逐条进入预览明细，应用时跳过该字段；验证：脚本断言未解析项出现在预览，且解析结果里没有猜测 id
- [x] 5.3 运镜参照列按中文名或 key 解析条目标识，只写 `lexicon_ref_key`，不下载视频、不写地址；验证：脚本断言中文名与 key 两种写法都落到 key，旧文件不产生该字段
- [x] 5.4 名称匹配到多个条目时视为未解析并在预览列出候选；验证：脚本构造歧义名称（两份同名素材、多个运镜条目）断言跳过并点名

## 6. 预览与端到端

- [x] 6.1 `src/intake/IntakeDialog.tsx` 与 `BundleDialog.tsx` 的预览展示表演补全、未解析参考与未解析运镜参照；验证：提示文案收口到 `src/intake/notices.ts`，`verify-storyboard-md-export.mjs` 断言三类提示在预览里各出现一次
- [x] 6.2 十三列导出文件回灌后四类字段等值；验证：`verify-storyboard-md-export.mjs` 单文件与 zip 两条回灌路径均断言选角、台词表演、表演、运镜参照等值
- [x] 6.3 九列旧文件回灌行为不变（不写入表演、选角、参考、运镜参照）；验证：脚本用九列样本断言这四个字段未被创建，且既有参考连线不被清空

## Workflow follow-up

- 归档前与 `pi-agent-material-tools` 对齐：参考解析与 agent 的 `link_shot_refs` 必须共用同一套名字匹配规则。
