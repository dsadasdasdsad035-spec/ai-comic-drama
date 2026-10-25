# 部署

两种方式，按你需要选：

| 场景 | 做法 | 抖音支持 |
| --- | --- | --- |
| 只跑应用，B 站/直链够用 | `docker compose up -d --build` | 需另配 yt-dlp + cookies，不稳 |
| 要抓抖音 | `./scripts/deploy-up.sh` | 内置 DTK，已验证 |

## 一键部署

```bash
cp deploy/.env.example .env      # 填渠道 Key（至少一个）与 DTK_ADMIN_PASSWORD
./scripts/deploy-up.sh
```

脚本做这些事，重复执行是幂等的：

1. 没有 `.env` 就从模板生成
2. 创建 `data/` 数据目录
3. 拉取固定版本的 DTK 源码到 `.dtk/src`（不污染仓库）
4. 生成 DTK 的随机密钥写进 `.dtk/src/.env`
5. 起 DTK 容器（含 `browser-rpc`——抖音必需）
6. 首次初始化管理员，铸造 API Key，写进 `.dtk/runtime.env`
7. 把 DTK 地址与 Key 注入根 `.env`
8. 构建并启动应用，等健康检查通过后打印地址

参数：

- `--no-dtk`：不起 DTK，只起应用
- `--rebuild`：强制重建应用镜像

## 手工部署

```bash
# 应用
cp deploy/.env.example .env
docker compose up -d --build

# DTK（可选）
./scripts/dtk-up.sh
```

## 会启动什么

```
storyboard-app-1          应用（页面 + API + ffmpeg + yt-dlp）  127.0.0.1:5273
dtk-api-1                 DTK REST API                          127.0.0.1:8000
dtk-worker-1              DTK 抓取 worker
dtk-postgres-1            DTK 数据库
dtk-redis-1               DTK 队列
dtk-browser-rpc-1         DTK 浏览器（铸造抖音游客身份）
```

DTK 是**独立的 compose 项目**（`-p dtk`），不用 `docker compose down` 停应用时连带停掉；停它要显式指定它的 compose 文件。

## 数据在哪

| 路径 | 内容 | 是否可丢 |
| --- | --- | --- |
| `data/projects/` | SQLite（项目/角色/镜头/设置/线程）+ 项目媒体 + 创意源视频 | **不可丢** |
| `data/media/generated/` | 镜头首帧、调度帧、证据帧 | 可重新生成 |
| `data/media/videos/` | 出片结果 | 可重新生成 |
| `data/media/voices/` | 配音 | 可重新生成 |
| `data/media/exports/` | 合成成片 | 可重新生成 |
| `.dtk/` | DTK 源码、它的 `.env`、`runtime.env`（含 API Key） | 丢了要重新初始化 |

备份只备 `data/projects/` 和 `.dtk/src/.env`（后者加解密了 DTK 存的 cookie）。

## 环境变量

完整列表见 `deploy/.env.example`。三个关键点：

1. **渠道 Key 留空 = 该渠道不可用**，不会回退到别的渠道。至少要配一个文本模型渠道。
2. **DTK 地址**：应用在容器里，不能写 `127.0.0.1`（那是容器自己）。用 `http://host.docker.internal:8000`。`deploy-up.sh` 会自动写这个。
3. **模型选择不在环境变量里**，在设置页的「默认路由」配。环境变量只解决「能不能连上渠道」。

设置页里的值优先于环境变量：容器里注入了 `DTK_API_KEY`，你在设置页填了另一个，用设置页的。

## 容器里没有的能力

| 能力 | 状态 | 原因 |
| --- | --- | --- |
| 3D 调度（Blender） | 不可用 | 镜像不装 Blender（体积与 GPU 依赖）；需要时挂载宿主 Blender 或改镜像 |
| macOS `say` 配音 | 不可用 | Linux 无此命令；用 MiniMax / 火山 / ElevenLabs / APIMart 任一 |
| yt-dlp 读浏览器 cookies | 不可用 | 容器里没有浏览器；抖音交给 DTK，B 站不需要 cookies |

这三项在界面上会显示明确的不可用原因，不会静默失败。

## 端口与访问

默认只绑 `127.0.0.1`，外部访问不到。要开给局域网或公网：

```bash
# .env
APP_BIND_ADDR=0.0.0.0
```

**但请先加认证**。这个应用没有登录系统：能打开页面的人就能用你的渠道 Key 花钱、改你的项目数据，也能删。至少放在带 Basic Auth 的反向代理后面。

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 容器 healthy 但页面 404 | 首次启动 vite 还在预热 | 等 10 秒；仍不行看 `docker compose logs app` |
| `ffmpegReady:false` | 镜像里 ffmpeg 缺失或路径错 | 镜像自带 `/usr/bin/ffmpeg`；自定义镜像需设 `FFMPEG_PATH` |
| 出图报缺 Key | `.env` 没填或填错渠道 | 检查对应 `*_API_KEY`；设置页「渠道」可测连通性 |
| DTK 适配器显示不可用 | 地址/Key 没注入 | 看 `.dtk/runtime.env`，或重跑 `./scripts/dtk-up.sh` |
| DTK 返回 `IDENTITY_POOL_EXHAUSTED` | 没起 browser 容器 | `./scripts/dtk-up.sh` 默认带 `--profile browser`，确认 `dtk-browser-rpc-1` 在跑 |
| `dtk-up.sh` 报找不到 setup token | 实例已初始化过 | 正常；脚本会跳过管理员创建，只铸造新 Key（`--force-key`） |
| 构建失败 | 全仓库 `tsc` 有错 | 镜像构建不跑 `tsc`（见下）；请单独跑 `npm run build` 修类型 |

## 关于镜像不跑 `npm run build`

应用运行时走 `vite dev`，因为 API 全在 `vite.config.ts` 的 `configureServer` 里——这是当前架构事实。静态构建产物在运行时用不上，所以镜像不做构建。

副作用是镜像构建不会拦住类型错误。类型检查请在提交前跑：

```bash
npm run build     # tsc --noEmit && vite build
```

要根治，需要把 API 抽成独立的 `server/index.mjs`（`DEPLOY-CHECKLIST.md` 里列为第一号阻塞项），之后镜像可以改成「静态产物 + Node 服务」，也能跑 `vite preview` 而非 dev server。
