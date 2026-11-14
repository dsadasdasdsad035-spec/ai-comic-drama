# Tasks

## 1. 媒体根与只读资产分层

- [x] 1.1 新增 `server/paths.mjs`，导出 `resolveMediaRoot` / `resolveStaticRoot` / `mediaPath`（`SB_MEDIA_ROOT` > `<root>/public`，`mediaPath` 做越界校验）；写 `verify-paths.mjs` 断言四件事：未设 env 时指向 `public/`、设 env 时指向该路径、`../` 穿越被拒、`mediaPath` 自动创建目录
- [x] 1.2 把 `vite.config.ts` 中 21 处 `path.join(root, 'public', ...)` 全部改为 `mediaPath(root, ...)`；验证：`rg "'public'," vite.config.ts` 除静态兜底常量外无残留，且 dev 下生成一张图落在与改动前相同位置
- [x] 1.3 把 `server/media.mjs`、`server/blender.mjs`、`server/vggt.mjs` 中 7 处 `'public'` 拼接改为 `mediaPath`；验证：`rg "'public'" server/*.mjs` 仅剩 `paths.mjs` 自身
- [x] 1.4 把 `resolveVideoRef` 与 `localMediaFile` 的「只接受 public 下文件」改为「只接受媒体根下文件」，同步更新两条错误文案；验证：`verify-lipsync.mjs` 与 `verify-videos.mjs` 全绿

## 2. 接口实现搬移出 Vite 配置

- [x] 2.1 新建 `server/app.ts`，把 `vite.config.ts` 的模块级 helper（约 1-2606 行）与巨型中间件回调（约 2631-7000 行）整体搬入，导出 `createAppHandler({ root })`、`runServerStartupTasks(root)`、`runServerShutdownTasks()`、`serveFile`、`mimeOf`；验证：`node --check` 无法用于 TS，改为 `npx tsc --noEmit` 通过，且 `node -e "import('./server/app.ts')"` 能成功加载
- [x] 2.2 `createAppHandler` 内保留模块级 `appRoot` 注入语义（首次赋值 + 重复赋值告警），把 `configureServer` 里的启动清理（`cleanupStaleJobs`/`cleanupVggtJobs`/`sweepStaleDrafts`）与 `httpServer.on('close')` 清理移入 `runServerStartupTasks`/`runServerShutdownTasks`；验证：dev 启动后 `.blender-jobs`、`.vggt-jobs`、`.scene-drafts` 的残留仍被清理
- [x] 2.3 `vite.config.ts` 瘦身为配置 + 插件壳（仅 `defineConfig`、插件列表、`server.port=5273`、watch.ignored、以及调用 `createAppHandler`）；验证：`wc -l vite.config.ts` 降到 100 行以内，dev 启动后 `/api/health` 返回 ok、`/api/project` 返回项目列表
- [x] 2.4 跑行为回归：`verify-canvas.mjs`、`verify-project.mjs`、`verify-settings-db.mjs` 三个脚本全绿，确认搬移无行为漂移（顺带把三个脚本与现行外壳对齐：选集目录入口、设置页五枢纽 IA、素材页角色 Tab）

## 3. 独立运行入口

- [x] 3.1 新建 `server/index.mjs`：解析 root（`import.meta.dirname/..`，非 `process.cwd()`）、读 `SB_PORT`（默认 5273，`0` 走系统分配）、`node:http` 监听 `127.0.0.1`、成功后打印 `[server] listening http://127.0.0.1:<port>`；验证：`SB_PORT=0 node server/index.mjs` 打印的端口与 `lsof -i` 实际监听一致
- [x] 3.2 实现静态托管四层（`/api/*` → handler；媒体前缀 → handler 内 `serveFile`；`dist/` 真实文件 → `serveFile`；其余 GET/HEAD → `dist/index.html`），并对未知 `/api/` 路径返回 JSON 404 而非 HTML；验证：`curl /api/not-exist` 得到 JSON，`curl /some/deep/route` 得到入口 HTML
- [x] 3.3 实现 `public/presets` 只读兜底（`STATIC_PUBLIC_DIRS` 常量），并在 `vite.config.ts` 设 `build.copyPublicDir = false`；验证：`npm run build` 后 `du -sh dist` 降到 10MB 以内且 `dist/presets` 不存在，但独立入口下 `/presets/camera-moves-whitebox-132/` 可访问
- [x] 3.4 实现优雅退出：SIGTERM/SIGINT 后 `server.close()`，5 秒后强制 `process.exit(0)`；验证：`kill -TERM` 后进程退出码为 0，且日志无未捕获异常
- [x] 3.5 端口占用处理：`EADDRINUSE` 时向 stderr 打印端口与原因并以非零码退出；验证：同端口启动两个实例，第二个退出码非 0 且 stderr 含端口号
- [x] 3.6 端口被占用、系统分配端口、健康检查三条场景各补一个 `verify-server-entry.mjs` 断言；验证：`node verify-server-entry.mjs` 全绿

## 4. 脚本与部署切换

- [x] 4.1 `package.json` 增加 `"start": "node server/index.mjs"`，保留 `dev` 不变；验证：`npm start` 后 `curl 127.0.0.1:5273/api/health` 成功
- [x] 4.2 更新 `Dockerfile`：构建阶段装全部依赖跑 `vite build`，运行阶段只装生产依赖并以 `node server/index.mjs` 启动，移除 dev server 相关注释里的技术债说明；验证：`docker build` 成功后容器内 `curl /api/health` 与首页均 200
- [x] 4.3 更新 `docker-compose.yml`：新增 `SB_MEDIA_ROOT=/data/media-root` 并挂载对应卷，保留既有 `SB_PROJECTS_DIR`；验证：`docker compose up -d` 后生成产物落在宿主机挂载目录而非镜像内
- [x] 4.4 更新 `README.md` 与 `DEPLOY-CHECKLIST.md` 中「生产跑 vite dev」的说明，改为独立入口；验证：文档里的启动命令逐条可执行

## 5. 集成验证

- [x] 5.1 用同一批验收脚本对独立入口跑一遍：`SB_URL=http://127.0.0.1:<port> node verify-canvas.mjs`、`verify-project.mjs`、`verify-charboard.mjs`，确认与 dev 结果一致
- [x] 5.2 `openspec validate server-standalone-entry --strict` 通过；验证：命令退出码 0 且无 warning

## Workflow follow-up

- 归档前确认 `docker compose` 旧配置（回退到 `vite dev`）仍可用一个版本周期。
- 归档后由 `desktop-shell-electron` 承接 Electron 壳、`utilityProcess` spike 与 ffmpeg 分发。
