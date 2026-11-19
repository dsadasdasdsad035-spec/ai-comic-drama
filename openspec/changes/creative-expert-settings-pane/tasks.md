# Tasks

## 1. 恢复专家数据层与接口封装

- [x] 1.1 恢复 `src/creative/expertTypes.ts`（`CreativeExpert`、`EXPERT_SKILL_WILDCARD`、`expertHasAllSkills`），验证 `npm run build` 的类型检查通过
- [x] 1.2 恢复 `src/creative/expertApi.ts`（`fetchExperts` / `fetchExpert` / `saveCustomExperts` / `importExpertsZip` / `expertExportZipUrl`），验证其请求路径与 `server/app.ts` 现有的 `GET/PUT /api/experts`、`import-zip`、`export-zip` 一致
- [x] 1.3 恢复 `src/creative/expertSoulHints.ts`，验证工具分组只覆盖 `builtinPlatformToolNames()` 现存的 41 项（去掉 `list_experts` 后 40 项，与 `DEFAULT_EXPERT_PLATFORM_TOOLS` 完全一致）。**`expertTools.ts` 不再恢复**：它服务的是已删除的旧 Pi 运行时（`buildCreativeExpertTools` 等无任何引用），新架构的工具与技能闸门在 `server/dsh-plugins/creative-expert`
- [x] 1.4 恢复 `src/creative/expertUi.ts` 与 `src/creative/expertExport.ts`，移除 `notifyCreativeExpertsChanged`（旧应用内聊天的事件，已无订阅方），验证 `npm run build` 无未使用导出与类型错误
- [x] 1.5 确认真实图标路由可用：对内置专家请求 `/api/experts/<id>/icon` 返回图片，缺失图标时回退到默认卡片图标（实测 `expert-omni` 返回 200 `image/svg+xml` / 510 字节，无 `icon.*` 的自定义专家返回 404，面板按空 `iconUrl` 回退首字头像）

## 2. 恢复专家管理面板并接线

- [x] 2.1 恢复 `src/settings/ExpertSettingsPanel.tsx`（列表 + 概览/Soul/技能/工具/高级 五个 Tab），删除 MCP 工具分组与对应 import，验证 `npm run build` 通过
- [x] 2.2 把 `SettingsPaneSwitch` 的 `experts` 分支接到新面板并移除 `ExpertsPane` 的说明页，验证「设置 → 创意专家」渲染出专家列表而不是说明文字
- [x] 2.3 面板把 `list_experts` 显示为锁定行、`list_installed_skills` 显示为「技能」组下的可勾选项，验证两者都不出现在普通外部工具勾选区
- [x] 2.4 保存路径改为只依赖服务端重编译：保存成功后提示「宿主正在运行时会重启，进行中的会话会中断」，验证提示文案出现且无遗留的 window 事件派发
- [x] 2.5 新增 `verify-expert-settings.mjs`（Playwright）覆盖：列表可见、内置专家只读、另存为自定义后新 id 出现在 `GET /api/experts`、保存后内置定义未变，验证脚本可独立跑通（11 项全过）

## 3. 收窄工具白名单口径

- [x] 3.1 把 `server/dsh-experts.mjs` 的 `ALWAYS_ON_TOOLS` 收窄为 `['list_experts']`，验证不再强制注入 `list_installed_skills`
- [x] 3.2 在 `tests/dsh-experts.mjs` 增加断言：`toolIds` 不含 `list_installed_skills` 的专家其工具子集也不含它，含则包含，验证 `npm run test:studio` 通过（`tests/dsh-experts.mjs` 22 项全过）
- [x] 3.3 校验既有专家的兼容性：对 `experts/expert-omni/manifest.json` 重新编译后工具数仍为 41（该专家本来显式勾选了 `list_installed_skills`），验证 `dsh/profiles/web/creative-experts.json` 中 `tools` 计数不变（三个专家 41/41/41 与技能 21/12/7 均未变）

## 4. 同步文档

- [x] 4.1 更新 `docs/creative-experts-ux.md` 的「现状」段与 §10 决策表：管理入口回到应用设置页，`list_installed_skills` 改为「由专家勾选」，验证文中不再出现「在创意宿主设置里管理专家」
- [x] 4.2 更新 `docs/creative-host.md` 的排障表：新增「专家列表为空 / 新专家没生效」对应到应用设置页与 `[studio-experts]` 日志，验证条目指向的命令与当前实现一致（另补「谁决定专家能用哪些工具」小节，说明 `list_experts` 锁定、`list_installed_skills` 需勾选）
