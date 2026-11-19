# Design

## Context

动机见 `proposal.md`。以下现状决定了方案形状。

**专家的落盘与生效是两段。** `server/dsh-experts.mjs` 把 `experts/<id>/manifest.json` 与 `soul.md` 编译成三样东西：一行 `@deepseek-ai/dsh-agent-preset`、一行 `@deepseek-ai/dsh-persona`（`complete: true`，soul 即完整 system）、以及一个 per-expert 技能根。产物写到 `creative-experts.patch.yml`，由 `creative-host` 以 `--patch` 叠加：

```js
// server/creative-host.mjs
const args = [entry, '--profile', 'web']
for (const patch of options.patches || []) {
  if (fs.existsSync(patch)) args.push('--patch', patch)
}
```

CLI 把它当成启动期 overlay（`context.overlays`），`readProfilePatches()` 只对 profile 与 home 两份 patch 重读磁盘，overlay 用的是内存快照。宿主的 HMR 也只监听这两个文件：

```js
// deepseek-harness/packages/boot/hmr/src/index.ts
const patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)]
```

结论：**专家变更在架构上必须重启**。这个边界要在设计里写清，而不是留成隐含行为。

**重启判据只比个数。** `server/index.mjs` 用 `id:工具数:技能数:是否通配` 拼签名，因此改 `soul`、换同数量工具或技能都不会触发重启。

**技能根是删掉重建。** `syncExpertSkillRoot` 先 `rmSync(base, { recursive: true })` 再逐个 `symlinkSync`。窗口期内技能不可见，监听器也会看到整棵子树消失再出现。

**技能变更不通知宿主。** `settingsChangedHook` 只在 `saveAppSettings()` 与 `PUT /api/experts` 两处触发；`/api/skills/upload`、`/api/skills/upload-zip`、`DELETE /api/skill-installs/<id>`、技能覆盖重置都没有触发。

**工具清单只拉一次。** `server/dsh-plugins/creative-tools/index.js` 在 `apply()` 里 fetch 一次 `/api/studio/tools` 然后 `ctx.tools.register`，之后只有 `ctx.effect` 的卸载会 dispose。`StudioToolBridge.ensureLoaded` 又按 `project+episode` 键缓存 module 与 tool map。

**约束**：工具声明唯一来源是 zod schema，不存在第二份手写参数表；插件注册必须幂等；工具执行不能因刷新而被打断。

## Goals / Non-Goals

**Goals:**

- 专家改动（含 `soul`）一定触发重同步，不出现"界面已改、宿主仍在跑旧 persona"。
- 技能增删与白名单变更在不需要重启宿主的前提下反映到可用技能列表。
- 工具清单（schema 层面）变更无需重启宿主即可生效。
- 三个静默失效都有可回归的用例。

**Non-Goals:**

- 不改 `deepseek-harness` 子模块。
- 不实现专家无重启热换（preset 是启动期 overlay）。
- 不改技能包的安装、目录优先级、卸载语义。
- 不把 MCP 接入创意链路。
- 不解决"重启本身慢"（属于 `studio-host-prewarm-keepalive`）。

## Decisions

### D1：内容指纹在 `dsh-experts.mjs` 计算，随编译结果返回

指纹覆盖 `id`、`name`、`description`、`soul`、排序后的 `toolIds` 与 `skillIds`。`writeExpertsPatch` 为每个专家算指纹，返回整批签名（`id@fingerprint` 排序后用 `,` 连接），`index.mjs` 直接比较。

**为什么不在 `index.mjs` 算**：那里只有 `compiled` 摘要，不含 `soul`；要算就得再调一次 `listAllExperts()`，等于两处各自决定"什么算变更"，迟早漂移。指纹与编译在同一处，天然同步。

**备选与否决**：把 `soul` 哈希塞进 `compiled` 再拼字符串——能做，但指纹算法散在两处，改字段要改两遍。

### D2：设置变更通知携带原因，由消费者决定是否重启

`onSettingsChanged` 的钩子签名从 `() => void` 改为 `(info: { reason: 'settings' | 'experts' | 'skills' }) => void`。消费者按原因决定 `restartIfRunning`：只有 `skills` 传 `false`。

**为什么不用两个钩子**：`saveAppSettings` 一次保存可能同时影响模型与专家，两个钩子会重复同步；一个带原因的钩子保持单一路径。

**为什么不直接在技能路由里调 `syncExperts`**：`syncExperts` 是 `setupStudio` 的闭包，技能路由在 `app.ts`，跨模块调用会把 `app.ts` 绑到 `index.mjs` 的内部结构上。钩子是既有机制，扩参数最小。

### D3：技能根改增量同步，临时名 + 原子改名

```
desired = { id → 真实目录 }              // 白名单 ∩ 现有技能
删除：base 下不在 desired 的条目
新增：先在 .<id>.tmp 建软链（失败则复制），再 rename 成 .<id>
```

**为什么用临时名**：rename 在同一文件系统内是原子的，监听器只会看到"出现"，不会看到半成品。直接 `symlinkSync` 到目标名也可以，但复制回退路径（不支持软链的平台）会在窗口期暴露半个目录。

**为什么不保持删除重建**：一是窗口期内技能不可见，二是监听器可能把"整棵子树移除"当成一次大批量事件，反而更难判断。

### D4：工具清单带版本，插件在调用前比对

`/api/studio/tools` 响应增加 `version`：对工具声明（名字、描述、参数）做规范 JSON 后取哈希前 12 位。插件保存当前 `version`；`version` 变化时**先构建新注册表，再注销旧的，最后注册新的**。

**为什么"先建后销"**：如果先注销再拉取失败，会得到一个空工具表，模型会认为所有工具都消失了。先建后销保证失败时旧表仍在。

**备选与否决**：定时轮询（无人改动时白烧 CPU）；SSE 推送（新增一条通道，收益不抵复杂度）。

### D5：刷新时机 = 工具调用前 + 15 秒兜底，且有在途保护

- `tools/pre-execute`：模型调用工具的间隔天然是秒级，这里比对一次版本最自然。
- 15 秒定时：覆盖"用户改完 schema 立刻去看工具列表"的场景。
- `inFlight > 0` 时跳过刷新，避免注销正在执行的工具。

**为什么需要兜底定时**：只靠 `pre-execute` 会让"改完立刻查列表"看到旧 schema，而这正是设置页最常见的操作序列。

### D6：工具实现热更新可选，用 mtime 做 query 失效

`StudioToolBridge.ensureLoaded` 当前只 import 一次。改为记录 bundle 的 `mtimeMs`，变化时用 `?v=<mtime>` 重新 import 并清空 tool map。

**为什么单独列为可选项**：schema 热覆盖日常调整的绝大多数；实现热依赖 `npm run build:server` 已重跑，收益小、风险略高（Windows 上删除被占用的模块句柄行为不同）。可以延后独立提交。

### D7：把"专家必须重启"写成显式约束

设计里明确：preset 是启动期 overlay，HMR 不监听 `--patch` 文件，因此专家变更需要重启。实现上不做任何"偷偷热换"的尝试（例如改写内存声明或伪造 recompose）。

**为什么不尝试热换**：预设注册表明确"不写入任何声明、没有接口接受 YAML 写回"；绕过它需要动宿主源码，与"不改子模块"的非目标冲突。降低重启感知属于 `studio-host-prewarm-keepalive`。

### D8：技能热的降级路径（若软链不被监听器拾取）

主线是"增量软链 + 宿主目录监听"。若验证发现监听器不认软链新增，降级为：**把共享技能根直接挂进每个 preset，白名单仍由闸门插件在 `tools/pre-execute` 运行时判定**。

代价是模型会在候选列表里看到白名单外的技能（可被读工具拒绝），这正是当前 per-expert 技能根想避免的；因此这条只作为降级，不默认采用。

## Risks / Trade-offs

- **监听器是否拾取软链新增未知** → 先做一次 10 分钟验证（加一条软链、不重启、看候选列表）；不成立则走 D8 降级，并记录为已知限制。
- **刷新注销工具时正在执行** → `inFlight` 计数 + `pre-execute` 内自增自减；`inFlight > 0` 时跳过。
- **版本抖动导致反复重注册** → 哈希前对工具数组与参数对象做稳定排序；只在 `version` 真变时重注册。
- **技能根同步与宿主 watcher 竞争** → 临时名 + 原子 rename，监听器最多看到一次新增。
- **技能变更触发的同步被当成"配置已变"而重启** → D2 的 `reason` 分流；`restartIfRunning: false` 只在 `skills` 时使用。
- **指纹计算把无关字段算进去导致误重启** → 只用显式列出的六个字段，不用 `JSON.stringify(expert)`；专家对象上的临时字段不参与。
- **工具版本字段缺失时插件报错** → 插件对缺失 `version` 退化为"只在启动时拉一次"（当前行为），保证与旧服务端兼容。

## Migration Plan

按依赖顺序分四步，每步可独立回滚：

1. **指纹**（`dsh-experts.mjs` + `index.mjs`）：回滚 = 恢复旧签名拼法。
2. **通知带原因 + 技能路由触发**（`app.ts` + `index.mjs`）：回滚 = 钩子忽略参数、技能路由去掉触发。
3. **增量软链**（`dsh-experts.mjs`）：回滚 = 恢复删除重建。
4. **工具版本与刷新**（`app.ts` + 插件 + `studio-tool-bridge.mjs`）：回滚 = 插件忽略 `version`，按启动一次拉取。

不涉及磁盘布局迁移；`creative-experts.patch.yml` 与 `creative-experts.json` 的格式不变，指纹只出现在返回值里。

## Open Questions

无。技能热生效的粒度由既有 spec 要求（"新增、修改或删除后无需重启即可反映"）确定，降级路径 D8 仍满足该要求。
