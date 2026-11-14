# Tasks

## 1. 契约字段映射与合并

- [x] 1.1 在 `src/platform/projectDraft.ts` 新增 `designContractToSheet()`，把契约的 `summary_cn` / `prompt_en` 映射到 `DesignSheet` 的 `summaryCn` / `promptEn`，其余字段同名直取；验证：新增单测断言一条完整契约条目转换后字段齐全、`id` / `image` / `candidates` 在模型回传时原样保留
- [x] 1.2 把 `designs-v1` 分支改为 `mergeDesigns(currentDesigns, incoming)`，删除 `next.designs = rec.designs` 与 `next.designs = [...scenes, ...props]` 两条替换路径；验证：单测覆盖同名同类型合并不新增、异名新增、关联镜号取并集
- [x] 1.3 合并后对 `id` 为空的条目生成 `design-<kind>-<毫秒时间戳>-<随机后缀>`；验证：单测提交两张此前都不存在的卡，断言两者标识非空且互不相同；再断言改名后再次写回沿用原标识
- [x] 1.4 确认合并保留 `image` / `candidates` / `activeIdx` 与手工 `promptEn`；验证：单测给定一张带图带候选的旧卡，提交同名的纯文字条目，断言旧卡的图片与候选未被覆盖

## 2. 服务端原子写入

- [x] 2.1 在 `src/server/db.mjs` 的 `writeProject` 中把 `designs` 的 `DELETE` + 全部 `INSERT` 包进 `BEGIN IMMEDIATE` / `COMMIT`，异常时 `ROLLBACK` 后重新抛出；验证：构造一次会触发唯一约束冲突的写入，断言接口返回错误且原设定卡内容与提交前逐字段相同
- [x] 2.2 在 `open()` 的 `ensureColumns()` 之后补一次历史回填，只更新 `design_id = ''` 的行，并保证重复执行不产生新改动；验证：以现有 `a` 项目的库副本为夹具，连续执行两次回填，断言第一次 `scenes` 从 0 变 1、第二次无变化、其它列未变

## 3. 写回失败可见

- [x] 3.1 把 `applyProjectDraft` 改为返回 `Promise<DraftApplyResult>`，等待 `patchProject` 落地后才返回成功；验证：类型检查通过，且调用处全部 `await`
- [x] 3.2 同步收口三处调用方：`src/agent/builtinPlatformTools.ts` 的 `createSubmitTool`、`src/agent/stageTools.ts` 的提交工具、`src/creative/projectStageAdapter.ts` 的 `applyDraft`；验证：三处均 `await`，`WorkbenchChatAdapter.applyDraft` 的签名与实现一致
- [x] 3.3 失败路径不回写乐观快照：`patchProject` 拒绝时不得调用 `ctx.setSnapshot`；验证：单测桩一个 reject 的 `patchProject`，断言工具返回 `ok:false`、`setSnapshot` 未被调用、后续读取仍是提交前的内容

## 4. 模型可见的语义说明

- [x] 4.1 更新 `submit_designs` 的工具描述，写明"按类型和名称合并、不删除未提交的卡、删除请走人工卡片操作"；验证：读取工具 schema 的输出，确认描述包含合并语义，且 `validate_contract` 的帮助文本不再暗示整体替换

## 5. 集成验证

- [x] 5.1 在项目 `a` 上跑一次真实写回：提交一条与 `雨夜空地` 同名的新条目，验证 `read_asset_inventory` 返回 `scenes: 1`、该卡图片仍在、且没有新增重复卡
- [x] 5.2 提交两条全新场景卡，验证两张都落库且 `read_asset_inventory` 报 `scenes: 3`，不再出现唯一约束错误

## Workflow follow-up

- 按项目评审要求完成后再归档本 change
- 归档前确认 `openspec validate --strict` 通过
