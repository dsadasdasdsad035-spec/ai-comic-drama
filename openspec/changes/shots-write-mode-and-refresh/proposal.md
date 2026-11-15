# Proposal

## Why

镜头写回只有一条通道（`POST /api/project` 的 `shots` 数组），却同时承担两种互斥语义：`submit_shots` 这类整表写回把它当「当前全集」，画布防抖、单镜写回（`link_shot_refs`、`generate_keyframe` 等）、分镜表导入把它当「本次要改的那几条」。服务端一律按「缺席 = 孤儿」处理，于是每一次局部写回都会把其余镜头标成 `orphan`。

实测项目 `a`：15 镜中 14 镜带 `orphan: true`，只有最后一镜被单镜写回洗白。用户按直觉做的两个补救动作结果相反 —— 重新 `link_shot_refs` 是单镜写回，必然把 14 镜重新标脏；`submit_shots` 能洗净，但随后任何一次局部写回又回弹。同时画布把 `orphan` 恒定渲染为 `false`（`shotToData`），Inspector 的「孤儿」徽标是死代码、清理入口也已随镜头表退役，用户看不到也治不了，只能从 Agent 读回（`read_shots` 原样返回 `orphan: true`）里看到，进而被误导为「画布没把它们挂载上去」。

另一个真实缺陷被这个假象掩盖：Agent 在创意工作室写回镜头后，宿主从未收到「项目数据已变」的通知，画布与时间线要等重启/切项目才更新。

## What Changes

- **写回模式显式化**：`POST /api/project` 新增 `shotsMode: 'partial' | 'full'`，**缺省 `partial`**。`partial` 下未出现的镜头原样保留、不写 `orphan`；只有显式声明 `full` 的整表写回才按缺席标 `orphan`。
- **调用点分两半**：整表写回（`submit_shots` 等 `applyProjectDraft`、画布增删插改号、`delete_shots`、打开时 reconcile、出片改稿）声明 `full`；局部写回（画布防抖、`purgeRefIds`、`migrateCharRefs`、`writeShotBack` 单镜、分镜表导入）不传，走默认 `partial`。
- **分镜表导入改为局部语义**：导入只写文件覆盖到的集，MUST NOT 把其他集镜头标脏（现状 `planShotImport` 返回的是文件子集）。
- **历史孤儿一次性迁移**：以 `settings` 标记 + 幂等 SQL 清掉既有 `orphan` 标记，避免旧标记继续经 `read_shots` 喂给模型。
- **Agent 写回后水合画布**：创意工作室的 `materialHost` 打通 `onProjectDataChanged` → 宿主 `refreshProjectSnapshot`，任何 `submit_*` 成功落库后画布与时间线立即反映，MUST NOT 依赖重启或切项目。
- **BREAKING（数据语义）**：不再允许「没提交某镜就等于把它标孤儿」的默认推断。依赖该默认行为的写回点必须显式声明 `full`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `manual-row-editing`: 「不通过缺席推断删除」改为「按写回模式决定是否标记孤儿」——局部写回 MUST NOT 产生孤儿标记；只有显式整表写回才保留「缺席 = 孤儿（保留不删）」的保护语义。
- `canvas-shots-workbench`: 「Agent 写回后与导入共用落库与水合规则」补上可验证的强制条件——任何 Agent 写回入口（含创意工作室）写成功后 MUST 通知宿主并立即水合画布节点与顺序连线。

## Impact

- 服务端：`server/db.mjs`（`mergeShots` 增加 mode）、`server/app.ts`（`POST /api/project` 读取 `shotsMode`、参数校验）、一次性迁移（`open()` 或独立迁移入口）。
- 客户端：`src/api.ts`（`mergeProjectShots` 签名扩展）、`src/App.tsx`（5 处整表写回点声明 `full`；画布防抖/参考清理/导入保持默认；传入刷新回调）、`src/platform/projectDraft.ts`、`src/agent/builtinPlatformTools.ts`、`src/agent/promptRefineAdapter.ts`、`src/creative/CreativeStudio.tsx`（`materialHost.onProjectDataChanged`）。
- 测试：`verify-manual-rows.mjs`（按 mode 断言）、新增单镜写回不标孤儿、导入单集不影响其他集、迁移幂等、写回后触发刷新回调。
- 数据：既有项目的 `shots.extra.orphan` 会被一次性清除；不涉及删除镜头或产物。
