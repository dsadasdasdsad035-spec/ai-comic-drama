# Design

## Context

见 `proposal.md`。DSH 桥将 `createBuiltinPlatformTools` 按「项目 + 集」缓存在进程内，`snapshotPromise` 跨多次 `invoke` 存活；且桥未注入 `getCanvasContext`，读工具只能看 SQLite。

## Goals / Non-Goals

**Goals:**

- 每次工具调用前清空读快照；同一调用内仍只拉一次项目。
- 浏览器防抖推送画布节点、角色、坏链、视频模型与分辨率；桥按项目名注入闭包。
- `read_shots` / `read_shot_detail` 在有实况时用 `nodeToShot` 覆盖同 id 镜头字段。

**Non-Goals:**

- 不推送 PromptRenderBundle、转场接缝编辑器中间态。
- 不把画布推送做成持久化；进程重启后需前端再推。
- 多标签并行项目的会话级隔离（仍单槽位）。

## Decisions

1. **`resetReadSnapshot` 挂在平台工具数组上**  
   桥在 `invoke` 开头调用，不销毁工具表。替代：每次 `invoke` 重建工具表——成本过高。

2. **`/api/studio/canvas-context` 与 `studioProject` 同鉴权**  
   浏览器 `credentials: include`；宿主不直接写此路由。替代：内部令牌——浏览器无法持有。

3. **`shotsData` 合并策略**  
   以项目快照为底，画布节点按 `shotId` 覆盖。无实况时行为不变。

4. **防抖 400ms（App）**  
   与项目推送模式一致，避免拖节点时打满服务端。

## Risks / Trade-offs

- **[Risk] 实况体积大** → 只服务当前项目；专家读列表仍走 `packRecords` 预算。  
- **[Risk] 实况与 DB 短暂不一致** → 合并后读工具以实况为准，写工具仍以 `ensureProjectLoaded` 现取为合并基准。  
- **[Trade-off] 单槽位** → 多标签后写覆盖；与 `studioProject` 相同限制。

## Migration Plan

1. `npm run build:server`  
2. `npm run test:studio-tools`  
3. 无需数据迁移。