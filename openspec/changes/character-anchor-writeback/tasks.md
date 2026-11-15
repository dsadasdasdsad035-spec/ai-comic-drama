# Tasks

## 1. 统一角色形状边界

- [x] 1.1 在 `src/charMap.ts` 让 `toSheet` 同时接受蛇形与驼峰输入（`look_cn` 缺失时回退 `lookCn`，其余字段同规则），缺字段按空值处理不抛错；`npm run build` 通过
- [x] 1.2 在 `src/charMap.ts` 增加读入口 `readCharacters(list)`：把项目快照的角色数组逐个转成 `CharacterSheet`，写入口仍复用 `toProject`；`readCharacters` 在 `characterRosterOf`/`materialTools` 里可直接替代裸数组遍历
- [x] 1.3 新增 `tests/character-shape.ts` 并登记进 `verify-skills-unit.mjs` 的 `TESTS`：断言蛇形输入读回锚点、驼峰输入读回锚点、缺字段输入不抛错、`toProject(toSheet(x))` 保持 `look_cn`/`look_en`/`palette`/`keywords`；`node verify-skills-unit.mjs` 全部通过

## 2. 角色提交写回

- [x] 2.1 `src/platform/projectDraft.ts` 角色分支：读端用 `readCharacters(p.characters)`，写端把合并结果 `map(toProject)` 后交给 `patchProject`，快照写回接口形状；验证：冒烟中 `submit_characters` 成功后 `GET /api/project` 该角色 `look_cn`/`look_en` 非空
- [x] 2.2 增加写入前契约自检（纯函数导出）：待写角色必须带非空 `name`、必须只有蛇形字段、锚点必须与合并结果一致；不满足时返回失败并说明锚点未保存；`tests/character-shape.ts` 断言驼峰 payload 被拒、合法 payload 通过
- [x] 2.3 `src/charExtract.ts` 判断「已有角色是否已有锚点」改为取值后转字符串再 `trim`，字段缺失等价于无锚点并继续补空字段；`tests/character-shape.ts` 断言缺字段的已有角色不抛错且能被补写
- [x] 2.4 `src/platform/projectDraft.ts` 角色分支补充结果摘要：新增/更新角色名与实际写入的锚点数量一致，避免「成功但没写」；验证：`tests/character-shape.ts` 断言摘要中包含了新增角色名

## 3. 其余角色消费点

- [x] 3.1 `src/platform/projectDraft.ts` 的提示词分支把角色数组经 `readCharacters` 转换后再做锚点展开；验证：`tests/character-shape.ts` 用带 `look_en` 的蛇形角色断言展开后 `unresolved` 为 0
- [x] 3.2 `src/agent/materialTools.ts` 的角色名册与「按名找角色」走 `readCharacters`，角色图片落库前用 `toProject` 转回接口形状；验证：`tests/character-shape.ts` 断言带锚点角色不再被判「没有英文外观锚点」、写回后未改动角色的锚点与参考图仍在
- [x] 3.3 `src/agent/builtinPlatformTools.ts` 的配音工具取角色音色改走 `readCharacters`（读 `voiceId` 而非裸对象属性）；验证：`tests/character-shape.ts` 断言蛇形角色（`voice` 有值）能解析出对应音色
- [x] 3.4 全仓复查 `project.characters` 的用法，把仍按界面模型读取的地方改为读入口或显式注明「透传原始形状」；验证：`rg -n "\.characters" src/` 清单逐条核对，并在 `tests/character-shape.ts` 注释里记录清单结论

## 4. 端到端冒烟

- [x] 4.1 `verify-creative-builtin-tools.mjs` 的 `submit_characters` 断言升级为「提交后从 `GET /api/project` 读回锚点一致」；`node verify-creative-builtin-tools.mjs` 通过
- [x] 4.2 `verify-creative-builtin-tools.mjs` 增加同名角色重复提交的用例：第二次提交同名角色必须 `ok`，且不破坏其他角色锚点；同一脚本通过
- [x] 4.3 跑 `node verify-all.mjs tool` 与 `npm run build`，确认既有冒烟与类型检查无回归

## 5. 存量数据说明

- [x] 5.1 在 `docs/character-expression-sheet.md`（或同类角色文档）记录：角色锚点写回曾因形状错位丢失，项目 `a` 的 `幼年白猫`/`成年白猫`/`新角色4` 需重新提交锚点；验证：文档中出现该段落并可被检索到
