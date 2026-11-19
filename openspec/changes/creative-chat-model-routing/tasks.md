# Tasks

## 1. 服务端环节类型收编

- [x] 1.1 `server/app.ts` 的 `Stage` 联合类型与 `STAGES` 加入 `'creative'`，并把 `BUDGET_STAGES` 改为 `STAGES` 的别名（删除重复定义）；验证：`npx tsc --noEmit` 通过，且新增用例证明 `normalizeStageModels({ creative: 'ark-plan-text-deepseek-flash' })` 保留该键（改动前会被丢弃）

## 2. 创意默认模型解析

- [x] 2.1 在 `server/app.ts` 导出 `studioDefaultModel()`：按 `stageModels.creative`（usable）→ `defaults.text`（usable）→ 首个 usable 解析，返回 `sb/<key>`，模型表为空返回 `sb/default`；`usable` 复用 `listStudioModels()` 的同一谓词；验证：新增用例覆盖三层优先级、绑定指向不可运行模型时下滑到下一层、空表返回 `sb/default`

## 3. 默认模型来源判定

- [x] 3.1 `server/studio-profile.mjs` 增加 `<DSH_HOME>/studio-default.json` 读写，并按 design D2 的四段规则决定是否改写 `agent-default-model`（缺失→写；等于上次写入值→更新；键已失效→写；其余→保留）；验证：新增用例逐条覆盖四个分支，且「保留」分支不产生写盘

## 4. 同步链路

- [x] 4.1 `server/index.mjs` 的 `syncProfile` 改用 `studioDefaultModel()`，并把默认模型 id 纳入变更签名（`模型列表 | default=<id>`）；验证：新增用例证明仅改变 `stageModels.creative` 也会触发 patch 重写，默认模型随之更新

## 5. 创意输出上限与空表退化

- [x] 5.1 `server/openai-gateway.mjs` 注入 `getCreativeMaxTokens()`，有值时在 `upstreamBody` 附带 `maxTokens`、为空时不带；`server/index.mjs` 按请求读取 `stageMaxTokens.creative`；验证：`tests/openai-gateway.mjs` 新增断言，覆盖「有值透传」与「留空不带字段」

- [x] 5.2 模型表为空时网关返回可读错误（提示去设置页绑定），不再走「模型标识没有对应的应用模型键」；验证：新增用例断言状态码与错误文案

## 6. 集成验证

- [x] 6.1 `npm run test:studio` 全绿；并实际核对开发模式下 `state/dsh/profiles/web/cordis.patch.yml` 的 `agent-default-model` 等于 `stageModels.creative`（未设置时等于 `defaults.text`）指向的模型

## Workflow follow-up

- 实现完成并通过评审后归档该变更。
