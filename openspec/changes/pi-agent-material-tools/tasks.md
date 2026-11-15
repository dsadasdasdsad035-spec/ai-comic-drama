# Tasks

## 1. 工具登记骨架

- [x] 1.1 `src/agent/builtinPlatformTools.ts` 的 `PLATFORM_ACTION_TOOL_NAMES` 增加 `link_shot_refs`、`set_shot_camera_lexicon`、`set_character_visual`、`generate_character_views`、`generate_expression_sheet`；验证：`verify-agent-tool-coverage.mjs` 通过，启动不再因清单不一致抛错
- [x] 1.2 `src/skills/tools.ts` 的 `KNOWN_TOOL_IDS` 增加这五个动作工具与 `submit_assets`；验证：`verify-skills-unit.mjs` 通过
- [x] 1.3 `src/creative/expertToolGroups.ts` 把新工具分别归入 `read`/`write`/`generate`/`project` 的正确分组，并加入 `DEFAULT_EXPERT_PLATFORM_TOOLS`；验证：新增断言确认每个新工具都能被 `classifyExpertTool` 归到非 `other` 组
- [x] 1.4 在 `createBuiltinPlatformTools` 注册全部新工具；验证：`assertPlatformToolConsistency` 在启动时不抛错，且 `platformToolNameDiff` 三类差异为空

## 2. 参考连线工具

- [x] 2.1 实现 `link_shot_refs`：参数 `no`、`episode?`、`kind`、`names[]`、`action: add | remove`；验证：`verify-refs.mjs` 或新增脚本断言 add 后该镜参考字段含目标、幂等重复调用不产生重复项
- [x] 2.2 名字解析：角色按角色名（含 `char-miss-*` 形式），素材按标题；未命中时报错并列出可用名字；验证：脚本断言未知角色名返回错误且项目数据未变
- [x] 2.3 重名素材卡返回错误并列出候选标识；验证：脚本构造同名两卡断言报错不写入
- [x] 2.4 `remove` 动作只移除目标项，不动其他参考；验证：脚本断言其余连线保留

## 3. 镜头语言工具

- [x] 3.1 实现 `set_shot_camera_lexicon`：参数 `no`、`episode?`、`entry`（key 或中文名）、可选 `clear`；验证：`verify-camera-lexicon.mjs` 断言绑定后三个字段写入
- [x] 3.2 绑定前调用既有 `/api/camera-lexicon/import` 拿项目内地址，再写 `lexicon_ref_key` / `lexicon_ref_url` / `motion_lexicon_as_ref`；验证：脚本断言地址为项目内路径且开关为开
- [x] 3.3 名称匹配多条时报错并列出候选；`clear` 清空三个字段并关闭开关；验证：脚本覆盖歧义与解绑两种情形
- [x] 3.4 绑定不创建素材卡；验证：脚本断言画布节点数量不变

## 4. 素材卡契约

- [x] 4.1 `src/skills/contracts.ts` 新增 `assets-v1`：`assets` 数组含 `title`、`kind`（六种取值）、`url`、可选 `designId`、可选 `characterName`；验证：`verify-tool-contracts.mjs` 断言合法与非法载荷的校验结果
- [x] 4.2 `src/platform/projectDraft.ts` 增加 `assets-v1` 写回分支：按 `designId` 或 `characterName + expression-sheet` 去重合并；验证：脚本断言同标识重复提交后只更新不新增
- [x] 4.3 `url` 必须在当前项目媒体中可解析，否则整批拒绝并说明；验证：脚本用项目外地址断言拒绝且数据未变
- [x] 4.4 写回同时更新项目素材列表与画布状态；验证：`verify-assets.mjs` 或 `verify-canvas.mjs` 断言重开项目后卡片仍在

## 5. 角色外观工具

- [x] 5.1 实现 `set_character_visual`：参数 `character`、`target: image | expression_sheet`、`url` 或 `assetTitle`；验证：`verify-character-card-ui.mjs` 或新增脚本断言采纳后角色当前图更新
- [x] 5.2 采纳表情总图时按固定 4×2 布局建立结构、算指纹并执行八格裁剪；验证：`verify-expression-sheet.mjs` 断言总图可用且八格有裁剪结果
- [x] 5.3 实现 `generate_character_views`（成本确认）：生成后写当前图并把结果放候选首位；验证：脚本断言需要确认、确认后写入，且既有表情总图未被标失效
- [x] 5.4 实现 `generate_expression_sheet`（成本确认）：忽略调用方提供的坐标与指纹，单格裁剪失败时保留总图并回报失败格；验证：脚本断言外部指纹被忽略、失败格在结果里点名
- [x] 5.5 角色外观写入走立即落库通道；验证：脚本断言写入后立刻重新读取项目即可看到新图
- [x] 5.6 项目外地址、无法解析的地址与不存在的素材标题一律拒绝并列出可用项；验证：脚本覆盖三种拒绝情形

## 6. 可见性与文档

- [x] 6.1 只读技能拿不到新工具；具备画布/素材/角色权限的专家能看到；验证：`verify-skills-unit.mjs` 断言 `READ_TOOL_IDS` 不含新动作工具
- [x] 6.2 每个工具的描述写清「寻址用名字」「成本需确认」「不自动建卡/连参考」；验证：`verify-apimart-tool-schemas.mjs` 断言顶层为 object 且描述非空
- [x] 6.3 更新 `docs/` 中平台工具清单（如存在）；验证：文档里的工具名与实际注册一致

## Workflow follow-up

- 归档前确认 `storyboard-export-fidelity` 已落地 `lexicon_ref_*` 三字段，否则运行期 `set_shot_camera_lexicon` 无处可写。
