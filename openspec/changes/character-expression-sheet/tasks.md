# Tasks

## 1. 数据模型与兼容

- [x] 1.1 在 `src/characters.ts` 增加 `ExpressionSheetCell`、`CharacterExpressionSheet`，在 `CharacterSheet` 增加 `expressionSheet?`；保留旧 `expressions?`，并在 `src/charMap.ts` 增加 `expression_sheet` 蛇形往返；验证：`npm run build` 通过，旧项目无字段读取不报错。
- [x] 1.2 在 `src/types.ts` / `src/api.ts` / `src/shotSync.ts` 增加镜头 `useExpressionRef` / `use_expression_ref`，默认 `false`，纳入 `bizSignature` 和 `mergeGenerated` 保留；验证：纯函数往返测试覆盖缺字段、true/false 和重新拆镜。
- [x] 1.3 新增 `src/expressionSheet.ts`：固定八情绪顺序、4×2 等分矩形、`cellForEmotion`、`sheetFingerprint`、`isSheetUsable`、`selectExpressionReference`（总图 > 旧单图 > 空）；验证：新增 `verify-expression-sheet.mjs` 覆盖格序、坐标、失效、旧数据回退。
- [x] 1.4 在 `src/api.ts` / `src/charMap.ts` 为 `ProjectAsset` 增加 `characterName?`，为画布素材识别 `expression-sheet` 预留字段；验证：项目资产读写往返不丢 `characterName`，旧 assets 仍可读。

## 2. 总图生成与替换

- [x] 2.1 把 `CharacterBoard` 的表情入口改为生成一张 4×2 总图：`n: 1`、`ratio: '16:9'`、固定八格顺序提示词、无文字/边框/标签；有 `c.image` 时传 `refImage`；验证：`verify-expression-sheet-ui.mjs` mock 请求体断言 `n=1`、有/无 `refImage` 两种路径。
- [x] 2.2 总图生成成功后原子替换 `expressionSheet` 并清空旧裁剪；失败/超时保留旧总图和旧单图；验证：UI mock 失败不覆盖，成功替换一次且不生成第二张候选。
- [x] 2.3 增加上传 4×2 总图替换：上传成功后按固定格序生成矩形、清空裁剪缓存；失败保留旧图；验证：UI 用例覆盖成功、非图片、保存失败。
- [x] 2.4 移除新的逐情绪生成入口，显示“1 张图”的成本和“无身份图参考”提示；不随拆角色/改镜头自动生成；验证：UI 断言旧八情绪按钮不再出现、成本文案正确、拆角色后请求数为 0。
- [x] 2.5 更新 README/`docs/character-expression-sheet.md` 的总图生成、成本、上传和旧图兼容说明；验证：按文档能找到一张图生成入口和成本口径。

## 3. 裁剪与分镜参考

- [x] 3.1 实现单格裁剪：按归一化矩形从同源总图裁出 PNG，经 `/api/save-image` 写入项目媒体目录，缓存 `cropUrl` 与 `cropFingerprint`；图片加载失败/跨域/保存失败返回可显示错误；验证：纯函数覆盖矩形和指纹，UI mock 覆盖成功与失败。
- [x] 3.2 修改 `collectShotReferences`：按 `performance` 优先使用有效总图单格，其次旧 `expressions`，否则文字回退；`expression-sheet` 素材卡连线不得整图进入参考，也不得重复添加；验证：`verify-expression-sheet-refs.mjs` 覆盖总图优先、旧图回退、stale、缺文件、整图排除。
- [x] 3.3 更新首帧生成参考说明与省略项：每角色最多一张表情单格，保持 10 张总上限；没有对应格时明确提示；验证：请求体断言不出现总图 URL，单格只出现一次，超限列出省略。
- [x] 3.4 更新 README 的参考图说明（总图只做画布/裁剪源，单格才进分镜）；验证：文档步骤与 `verify-expression-sheet-refs.mjs` 的断言一致。

## 4. 画布素材卡

- [x] 4.1 在 `AssetNode`/画布节点类型增加 `expression-sheet` 的“表情”标签和显示；角色卡增加“发布表情总图到画布”；按角色 upsert，重复发布更新同一张卡并保留位置/连线；验证：`verify-expression-sheet-canvas.mjs` 覆盖首次发布、重复发布、角色改名同步。
- [x] 4.2 把 `expression-sheet` 接入右键参考源和项目 assets 持久化；连线只建立素材归属，实际参考仍由 `performance` 选格；验证：UI 断言连线后请求只含单格，刷新后卡片和连线仍在。
- [x] 4.3 处理总图缺失/文件缺失/角色删除后的画布卡状态；不创建孤儿参考；验证：UI 用例覆盖缺失标记、删除角色后卡状态和重新发布。

## 5. 视频表情开关与参考预算

- [x] 5.1 在 Inspector「声音」页增加“带说话角色表情参考”开关，绑定 `useExpressionRef`，默认关闭并随镜头持久化；验证：`verify-video-expression-budget.mjs` UI 用例覆盖默认关闭、开启、刷新保留。
- [x] 5.2 修改 `buildShotVideoRequest`/`collectComposerRefs` 分配顺序：当前画面 → 全部入画身份 → 场景/道具/相邻/手工 → 可选的说话角色单格；关闭时不收集表情，开启时最多一张；超限先省略表情，再省略场景/道具；当前画面/身份不得静默省略；验证：纯函数覆盖单角色、双角色、无有效格、身份超 4 张阻止。
- [x] 5.3 更新出片面板：提交前显示开关状态、四个槽位实际内容、被省略项和原因；表情因预算被挤掉时在提交前提示；验证：UI 断言面板槽位与请求 `refImages` 一致，关闭时不显示表情占用。
- [x] 5.4 更新 README 的视频参考预算说明和回滚方式；验证：文档写明默认关闭、4 张顺序和身份超限阻止。

## 6. 角色卡 UI/UX

- [x] 6.1 重构 `CharacterBoard` 卡片：主图区 +「三视图/表情总图/音色」页签、摘要行（姓名/定位/年龄/状态/音色/表情完成度）、单一状态化主操作；验证：`verify-character-card-ui.mjs` 覆盖默认页签、状态文案和主操作映射。
- [x] 6.2 增加编辑抽屉：身份字段和试音稿移入抽屉，保存/取消明确；取消不写回；验证：UI 覆盖打开、修改、保存、取消、`lookEn` 变化后总图标 stale。
- [x] 6.3 实现 4×2 表情格交互：至少 44×44 点击区、标签、选中环、stale 标记、键盘焦点；点击只预览，不改镜头 `performance`；验证：UI 覆盖点击、键盘、失效格和镜头数据不变。
- [x] 6.4 完成空状态、错误状态、成本/参考预算 chip 和窄屏布局；主操作在 330px 卡宽、900px 视口高度下首屏可见；验证：Playwright 截图覆盖空总图、缺文件、选中镜头预算和窄屏。
- [x] 6.5 更新 README 角色卡说明与截图；验证：按文档完成“生成三视图 → 生成总图 → 发布画布 → 选镜头”的路径，步骤与 UI 文案一致。

## 7. 集成、回归与证据

- [x] 7.1 运行 `npm run build`、`node verify-expression-sheet.mjs`、`node verify-expression-sheet-ui.mjs`、`node verify-expression-sheet-refs.mjs`、`node verify-expression-sheet-canvas.mjs`、`node verify-video-expression-budget.mjs`、`node verify-character-card-ui.mjs`；验证：全部通过。
- [x] 7.2 跑既有 `verify-expression.mjs`、`verify-performance*.mjs`、`verify-character-voice*.mjs`、`verify-native-audio*.mjs`、`verify-lipsync*.mjs`、`verify-export.mjs`，确认旧逐情绪项目、旧参考顺序和导出不回退；验证：全部通过，旧数据用例保留。
- [x] 7.3 做一次 mock 端到端：角色总图 → 裁剪单格 → 首帧请求 → 发布画布 → 连线 → 视频开关开/关两次请求，记录槽位、省略项和成本；验证：全程无真实付费调用，证据写入 `evidence/README.md`。
- [x] 7.4 更新 `evidence/README.md` 和截图，记录总图生成成本、4 张预算、旧图兼容和未验证项；验证：证据不把 mock 写成真实模型验收，截图可复现。

## Workflow follow-up

- 先归档 `shot-performance-direction`，再归档本变更；归档前运行 `openspec validate character-expression-sheet --strict` 并同步 `character-expression-sheet` / `character-card-ui` / `shot-video-prompt` 主 specs。
- 真实图片/视频调用按现有付费确认规则执行；本变更的自动化测试只使用 mock/dryRun。
- 若主 specs 已存在逐情绪表情能力，归档时合并 Purpose/Requirements，不直接覆盖旧兼容路径。
