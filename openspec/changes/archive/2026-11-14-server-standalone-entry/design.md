# Design

## Context

`vite.config.ts` 共 7033 行，其中约 2600 行是模块级 helper（设置归一化、模型挑选、媒体与 ffmpeg 辅助），约 4370 行是一个 `server.middlewares.use(async (req, res, next) => ...)` 的巨型回调，内部用 47 条 `url === '/api/...'` 精确分支与 14 组 `url.startsWith(...)` 前缀分支分发。`appRoot` 是模块级可变变量，只在 `configureServer` 里被赋值一次。

约束：

- **Node 22.23 原生支持直接运行 `.ts`**（类型剥离默认开启，已在本机验证 `node t.ts` 成功）。这意味着抽取出来的 TS 模块可以被普通 `node` 进程直接 import，无需预编译。
- 仓库内 100+ 个 `verify-*.mjs` 通过 `SB_URL` 或硬编码 `127.0.0.1:5273` 访问，全部假定 Vite dev server 在场。
- 运行时媒体（`generated`/`videos`/`voices`/`exports`/`publish-packages`/`lipsync-qa`）目前直接写入 `public/`，共 28 处 `path.join(..., 'public', ...)` 指向点。
- 只有 `public/presets` 是随代码分发的只读资产（相机运动预设图），它必须继续随构建产物或仓库一起可用。

## Goals / Non-Goals

**Goals:**

- 一个 `node server/index.mjs` 就能替代「Vite dev server 跑生产」，且不引入任何运行时依赖。
- 迁移过程尽量是**代码搬移**而非重写：路由分支、错误消息、返回负载保持逐字一致，便于用既有验收脚本反向证明无行为漂移。
- 媒体根、端口、数据根全部通过环境变量注入，为桌面 sidecar 留好接口。

**Non-Goals:**

- 不引入 Express/Koa/Hono 等框架（`node:http` + 现有 connect 风格签名足够，且换取零依赖）。
- 不拆分巨型 handler 为多个路由模块。搬移已验证的 4000 行风险远低于重写；后续可以按 `/api/creative`、`/api/billing` 等前缀渐进拆分。
- 不做请求体大小、鉴权、CORS 的行为调整——这些属于现有实现，保持原样。
- 不解决 Blender/VGGT/ffmpeg 的随包分发（桌面端第二阶段议题）。

## Decisions

### D1：`server/app.ts` 承接全部接口实现，`vite.config.ts` 瘦身为配置

`server/app.ts` 导出 `createAppHandler({ root }): (req, res, next) => Promise<void>`。`vite.config.ts` 的插件只剩：

```ts
configureServer(server) {
  runServerStartupTasks(server.config.root)
  server.middlewares.use(createAppHandler({ root: server.config.root }))
  server.httpServer?.on('close', () => runServerShutdownTasks())
}
```

选择 `.ts` 而非 `.mjs`：文件内已有大量类型标注（`type Provider`、`as` 断言、参数类型），改写成 `.mjs` 需要逐处删类型，属于高风险机械编辑；保留 `.ts` 则几乎零改动。

**实施期修正**：原计划「Node 22.23 原生类型剥离直接跑 `.ts`」不成立——`app.ts` 还 import 了 `src/` 下的 TS 模块（`src/modelCaps`、`src/voiceCatalog` 等），这些模块自身用 `@/` 别名与无扩展名相对路径，Node 的 ESM 解析无法加载。改为 **esbuild 预打包**：

```text
npm run build:server
  esbuild server/app.ts --bundle --platform=node --format=esm --target=node22 \
          --packages=external --outfile=server-build/app.mjs
```

`--packages=external` 把 node_modules 留在外部（它们本来就是 dependencies），只把 `server/*.mjs` 与 `src/*.ts` 打成一包。esbuild 已是 devDependency，构建阶段用，运行镜像不需要。`npm start` 通过 `prestart` 自动先打包。

### D2：保留模块级 `appRoot`，由 `createAppHandler` 注入

不做「把 root 穿透到每个 helper」的改造。当前 `appRoot` 只在 `getAppSettings`/`saveAppSettings` 等 3 处被读，穿透会牵动几十个调用点却收益为零。`createAppHandler` 在首次调用时设置模块级 `appRoot`，语义与今天 `configureServer` 里的赋值一致。

*风险*：同一进程内两个 handler 用不同 root 会互相覆盖。当前没有这种用法，桌面端是「一进程一实例」，可接受；在 `createAppHandler` 里对重复赋值给出警告。

### D3：媒体根是独立概念，解析收敛到 `server/paths.mjs`

新增最小模块：

```js
resolveMediaRoot(root)        // SB_MEDIA_ROOT > root/public
resolveStaticRoot(root)       // root/public，只读资产（presets）
mediaPath(root, ...segments)  // 拼到媒体根并做越界校验
```

把 28 处 `path.join(root, 'public', X)` 改为 `mediaPath(root, X)`。`server/media.mjs`、`server/blender.mjs`、`server/vggt.mjs` 通过同一模块取值，避免各自读 env。

`resolveVideoRef` 与 `localMediaFile` 的「只接受 public 下文件」语义改为「只接受媒体根下文件」，错误消息同步更新——这是**唯一允许改变用户可见文案**的地方，因为原文案在自定义媒体根下会说不通。

### D4：独立入口用 `node:http`，静态托管分三层

```text
1. /api/*            -> createAppHandler
2. 媒体前缀          -> app handler 内部已有 serveFile（含 Range），原样复用
3. dist/ 真实文件    -> 静态直出（复用 app.ts 导出的 serveFile）
4. 其余              -> dist/index.html（SPA 回退，仅 GET/HEAD）
5. public/presets    -> 作为 dist 缺失时的兜底只读目录
```

`serveFile` 从 `app.ts` 导出，独立入口复用同一份实现，Range/416 行为天然一致。

### D5：端口握手用 stdout 单行协议

`server/index.mjs` 监听成功后打印：

```text
[server] listening http://127.0.0.1:<port>
```

不用固定端口+重试探测，因为桌面端要多实例共存、且用户机器上 5273 可能被自己的开发环境占着。`SB_PORT=0` 是桌面端默认值；开发模式仍是 `vite.config.ts` 里的 5273。

### D6：`build.copyPublicDir = false`，只读资产显式保留

当前 `dist` 因拷贝 `public/` 达到 228MB（代码仅 2.5MB）。设为 `false` 后：`dist` 只含前端代码；`public/presets` 由独立入口的兜底层提供（也在仓库里，容器镜像天然包含）。这样桌面端打包不会把自己 192MB 的素材发出去。

*权衡*：若将来 `public/` 下新增其它只读资产，需要同时改这里的兜底列表。用一个显式常量数组（`STATIC_PUBLIC_DIRS = ['presets']`）把这个约定写在代码里，避免隐式依赖。

## Risks / Trade-offs

- **[搬移过程漏改 import 导致 7000 行模块立即崩]** → 搬移后先跑 `node --check` 与 `tsc --noEmit`，再启动 dev server 打 `/api/health` 与 `/api/project`，最后跑 3 个代表性验收脚本（`verify-canvas`、`verify-project`、`verify-settings-db`）。
- **[`appRoot` 在独立入口下为 `process.cwd()`，与仓库根不一致]** → 独立入口显式取 `import.meta.dirname/..` 作为 root，不依赖 cwd；容器里工作目录是 `/app`，两者一致。
- **[`node:sqlite` 在 Electron 内置 Node 下可能不可用]** → 本 change 不解决，属于桌面端 spike；独立入口是普通 `node` 进程，天然不受影响。
- **[`copyPublicDir=false` 后有人依赖 `dist/generated` 等目录已存在]** → 媒体根解析统一走 `mediaPath()` 并 `mkdirSync(..., {recursive:true})`，不依赖预置目录。
- **[既有验收脚本里个别依赖 Vite public 索引（启动时快照）]** → 这正是 `serveFile` 直出存在的原因；独立入口静态层按磁盘实时判断，比 Vite 更宽松，不会更严格。
- **[生产从 dev server 切到独立入口，`allowedHosts` 等 Vite 专有行为消失]** → 反代/ngrok 场景改由独立入口默认不校验 Host 承接；若需要限制，后续用环境变量加白名单。

## Migration Plan

1. 先落地 `server/paths.mjs` 并只替换媒体路径拼接（行为可验证：仍指 `public/`）。
2. 搬移 `server/app.ts`，`vite.config.ts` 瘦身，跑 dev 验收确认零漂移。
3. 落地 `server/index.mjs`，与 dev 并行共存，用同一批验收脚本指向独立端口跑一遍。
4. 改 Dockerfile/compose 使用独立入口；保留回退开关（`docker compose` 旧配置可切回 `vite dev` 一个版本周期）。
5. 回滚策略：任一阶段出问题，`vite.config.ts` 的瘦身可通过 git revert 单文件恢复，媒体根因默认值仍是 `public/` 而不产生数据迁移。
