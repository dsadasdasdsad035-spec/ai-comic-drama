# Proposal

## Why

创意会话迁到 dsh 宿主时，专家的运行链路保留下来了（preset + persona + 工具限制 + 技能根），但**管理链路被整块删掉了**：应用侧 `设置 → 创意专家` 现在只剩一句「去宿主设置里管理」的说明，而宿主的 0.2.2-rc.5 设置页只有只读的 preset 查看与「设为默认」，没有专家编辑入口。结果是今天新增或修改一个专家只能手工调 `PUT /api/experts`、导入 zip 或直接改 `<DSH_HOME>/experts/<id>/` 下的文件——专家能用，但没法配。

同时暴露出两处规格与实现的偏差：`list_installed_skills` 被代码强制注入（文档与 spec 都写「由专家勾选」），以及「会话绑定专家」在新宿主语义下已不成立（preset 只能在空白会话选，开跑后固定）。

## What Changes

- **恢复应用侧专家管理面板**：`设置 → 创意专家` 从说明页换回列表 + 详情编辑（概览 / Soul / 技能 / 工具 / 高级），支持新建、另存为自定义、删除、JSON 与 zip 导入导出。数据仍走既有的 `GET/PUT /api/experts`、`/api/experts/import-zip`、`/api/experts/<id>/export-zip`，不新增服务端接口。
- **工具白名单口径对齐文档**：只把 `list_experts` 作为平台强制项；`list_installed_skills` 回到「专家勾选才可见」。面板把 `list_experts` 显示为锁定项，不再列为可勾选工具。
- **移除 MCP 勾选**：创意会话没有桥接 MCP 工具，专家 `toolIds` 里的 `mcp.*` 会被 `resolveToolSubset` 静默丢弃。面板不再展示 MCP 分组，避免出现「勾了但没生效」。
- **界面文案改为宿主语义**：专家 = 宿主 Agent preset；只有空白会话可选，保存会重编译 preset 并在运行中重启宿主。
- **spec 修订**：`creative-experts` 的「专家目录与持久化」「会话绑定专家」按新语义重写，并补充「管理入口在应用设置页」与「list_installed_skills 非强制」两条要求。

## Capabilities

### New Capabilities

无。专家管理的既有行为归属 `creative-experts`，不另开与它重叠的能力。

### Modified Capabilities

- `creative-experts`: 管理入口从「宿主的创意专家设置」改为应用设置页；「会话绑定专家」改为「会话在创建时记录 preset，空白会话才能切换」；新增「`list_installed_skills` 非强制注入」的工具白名单口径。

## Impact

- 前端恢复：`src/settings/ExpertSettingsPanel.tsx`、`src/creative/expertApi.ts`、`expertTypes.ts`、`expertTools.ts`、`expertSoulHints.ts`、`expertUi.ts`、`expertExport.ts`（`expertStorage.ts` 不复用，会话级记忆已无对应运行时）。
- 接线：`src/settings/hubs/SettingsPaneSwitch.tsx` 的 `experts` 分支由 `ExpertsPane` 换成恢复后的面板；`settingsNav` 菜单项已存在，无需改动。
- 服务端：`server/dsh-experts.mjs` 的 `ALWAYS_ON_TOOLS` 只保留 `list_experts`；专家保存后的重编译与重启走现有 `notifySettingsChanged('experts')` → `syncExperts`，不新增流程。
- 文档：`docs/creative-experts-ux.md` 的「现状」段与 §10 决策表需与面板回归后的入口一致。
- 不影响既有 preset 数据、技能根与工具桥；已保存的自定义专家无需迁移。
