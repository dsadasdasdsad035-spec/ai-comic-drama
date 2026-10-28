# 部署到服务器（Docker Compose + 口令代理）

> 本文记录当前生产机的部署形态。目标机是全新机器时，照「首次部署」走一遍即可。

## 形态

```
公网 :80  → 域名请求 301 到 HTTPS；IP 请求直接进代理（HTTP）
公网 :443 → nginx（TLS + Basic Auth）→ app:5273（容器内 vite dev，API 在 configureServer 里）
                                        ↑
                          宿主仅回环 :5274（APP_BIND_ADDR=127.0.0.1）
```

需要代理的原因：应用没有登录态，而 `GET /api/settings` 会**明文返回渠道 API Key**。
只暴露 `docker-compose.auth.yml` 里的 proxy，宿主侧的应用端口绑在回环上。

## 证书与域名

证书放在 `deploy/ssl/fullchain.pem` + `deploy/ssl/privkey.key`（挂进 proxy 容器，不进仓库/镜像）。
当前证书是 Sectigo DV，SAN 为 `rechargeai.cn` / `www.rechargeai.cn`，2027-01-07 到期。

**证书链必须按 leaf → intermediate → cross-signed root 排序。** 从旧机器搬过来的 chain
顺序是乱的（根证书夹在中间证书前），浏览器会报「证书链不完整」。重排命令：

```bash
# 拆开每一张证书，确认 subject / issuer
awk 'BEGIN{n=0} /BEGIN CERTIFICATE/{n++} {print > ("c" n ".pem")}' fullchain.pem
for f in c*.pem; do openssl x509 -in "$f" -noout -subject -issuer; done

# 按 leaf → intermediate → root 重新拼，并验证
cat c1.pem c4.pem c3.pem > fullchain.pem
openssl verify -untrusted <(cat c4.pem c3.pem) -CAfile /etc/pki/tls/certs/ca-bundle.crt c1.pem
```

验证线上实际下发的链（期望 3 张，`Verify return code: 0`）：

```bash
echo | openssl s_client -connect rechargeai.cn:443 -servername rechargeai.cn -showcerts 2>/dev/null \
  | openssl crl2pkcs7 -nocrl -certfile /dev/stdin | openssl pkcs7 -print_certs -noout
```

## 首次部署

```bash
# 1. 源码到目标机（排除本机数据、密钥、验证脚本）
rsync -az --exclude node_modules --exclude .git --exclude data --exclude projects \
  --exclude .env --exclude deploy/proxy/.htpasswd --exclude deploy/ssl --exclude openspec \
  ./ root@HOST:/opt/storyboard/

# 2. 配置
cd /opt/storyboard
cp deploy/.env.example .env && chmod 600 .env     # 填渠道 Key；APP_BIND_ADDR=127.0.0.1
mkdir -p data/projects data/media/{generated,videos,voices,exports}

# 3. 口令与证书
mkdir -p deploy/proxy deploy/ssl
htpasswd -c deploy/proxy/.htpasswd storyboard     # 或 printf 'user:%s\n' "$(openssl passwd -apr1 '密码')"
cp fullchain.pem privkey.key deploy/ssl/ && chmod 600 deploy/ssl/privkey.key

# 4. 起服务
docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d --build app proxy
```

`.env` 里代理相关：`PUBLIC_BIND_ADDR=0.0.0.0`、`PUBLIC_PORT=80`、`PUBLIC_TLS_PORT=443`。

## 默认配置

模型表、环节默认模型、价格、Agent 设置、技能规则包都存在
`data/projects/storyboard.sqlite` 的 `settings` / `skill_overrides` 表，**不在代码里**。
换机器时如果要从开发机带过去，只导这两张表，不要带项目数据：

```bash
sqlite3 projects/storyboard.sqlite ".backup '/tmp/seed.sqlite'"
sqlite3 /tmp/seed.sqlite "DELETE FROM projects; DELETE FROM characters; DELETE FROM assets;
  DELETE FROM designs; DELETE FROM scene_layouts; DELETE FROM episodes; DELETE FROM scenes;
  DELETE FROM shots; DELETE FROM chat_threads; DELETE FROM creative_sessions;
  DELETE FROM creative_threads; DELETE FROM creative_sources; DELETE FROM creative_shots;
  DELETE FROM creative_artifacts; DELETE FROM deliverables; DELETE FROM publish_accounts;
  DELETE FROM publish_jobs; DELETE FROM publish_events; DELETE FROM publish_intents;
  DELETE FROM stock_imports; VACUUM;"
scp /tmp/seed.sqlite root@HOST:/opt/storyboard/data/projects/storyboard.sqlite
```

服务器上没有 DTK 与桌面浏览器，导入后要把创意摄取改成容器内 yt-dlp：

```js
settings.creative.ingest = {
  ytdlp: { enabled: true, bin: '/usr/local/bin/yt-dlp', cookiesFromBrowser: '', cookiesFile: '' },
  dtk: { enabled: false, baseUrl: '', apiKey: '' },
}
```

## 与开发机的差异

| 项 | 开发机 | 服务器容器 |
| --- | --- | --- |
| ffmpeg | `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` | `/usr/bin/ffmpeg`（Debian 包，带 libass + xfade） |
| 字幕字体 | PingFang / Heiti | `fonts-noto-cjk`，优先取 `Noto Sans CJK SC` 字面 |
| 配音 | macOS `say` 兜底 | 无 `say`，走已绑定的云端音频模型（当前 `minimax:speech-2.8-hd`） |
| 创意摄取 | DTK 或 yt-dlp | 仅容器内 yt-dlp（`YTDLP_BIN=/usr/local/bin/yt-dlp`） |
| 平台自动发布 | 本机 Chrome + profile | 不可用，只能导出发布包 |
| 3D 渲染 | 本机 Blender | 不可用（`BLENDER_BIN` 留空） |

`/api/health` 的 `ttsReady` / `ttsProvider` 现在按**当前绑定的音频模型**判定，
不再只看 `say` 是否存在，所以 Linux 上不会误报配音不可用。

## 自检

```bash
# 域名：80 必须跳 443
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://rechargeai.cn/
# 期望 301 -> https://rechargeai.cn/

# 无口令必须 401（这是 Key 不泄露的关键）
curl -s -o /dev/null -w '%{http_code}\n' https://rechargeai.cn/api/settings

curl -s -u USER:PASS https://rechargeai.cn/api/health
# 期望：hasKey/videoReady/ffmpegReady/ttsReady 全 true，ffmpegCaptionFont 为 *CJK SC

curl -s -u USER:PASS https://rechargeai.cn/api/project        # 期望 ok + projects
curl -s -o /dev/null -w '%{http_code}\n' http://HOST:5274/api/health   # 期望 000（回环，公网不可达）
```

HMR 走 WebSocket，代理必须带 `Upgrade`/`Connection` 头（配置里已加）。验证握手返回 101：

```bash
curl -s -u USER:PASS -o /dev/null -w '%{http_code}\n' --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://rechargeai.cn/
```

真实链路（会消耗额度）：`POST /api/text` → `POST /api/voice` → `POST /api/seedream`。

## 上线后发现并修掉的问题（2026-10-27）

| 症状 | 根因 | 修法 |
| --- | --- | --- |
| 从素材库选的图导出被静默丢镜，报「没有任何可用的画面」 | `materialize()` 只解析 `public/`，不认 `/project-assets/<项目>/<文件>` | 先走 `parseProjectMediaUrl` + `resolveProjectMediaPath` |
| 发布台报 `no such column: auto_draft_note` | `ensureColumns()` 是手写清单，只覆盖 characters/assets | 改成从 `SCHEMA` 自动推导所有表的所有列 |
| 视觉理解回答「图片数据被截断」 | Agent Plan 的 `/api/plan/v3` 不解析 `image_url`，把 dataURL 当文本 | 该条目降级为文本；视觉默认改 `apimart-text-gemini-3-5-flash`，并在读设置时自愈 |

第三个问题值得单独说明：这不是配置错误，而是渠道能力判断错了。判断「某模型能不能看图」
不能只看它是否挂在多模态供应商下，必须真正发一张图验证。当前可用且实测能读图的视觉模型是
APIMart 的 Gemini 3.5 Flash / GPT-5.1 / Claude 系列；标准方舟的 `ARK_API_KEY` 已失效
（`AuthenticationError: The API key doesn't exist`），所以 `ark` 渠道的 Seedance 出片不可用，
出片请走 APIMart 的 `catalog-apimart-seedance-1-0-pro-fast` 等条目（已实测出片成功）。

## 容器里的 Blender / Chromium（2026-10-27 补装）

### Blender

Debian bookworm 自带的是 Blender 3.4，低于应用支持的 4.2 下限，所以镜像里装官方 tarball：

```dockerfile
ARG BLENDER_SERIES=4.5
ARG BLENDER_VERSION=4.5.4
# 解到 /opt/blender，软链 /usr/local/bin/blender
```

**引擎必须是 cycles。** 容器没有 GPU，EEVEE 的 GPU 后端在 `--background` 模式下取不到设备，
compose 里用 `BLENDER_ENGINE=cycles` 覆盖默认值（原默认是 eevee）。

依赖包不能省：libx11-6 / libxi6 / libxxf86vm1 / libxfixes3 / libxrender1 / libxext6 /
libxkbcommon0 / libsm6 / libice6 / libegl1 / libgl1 / libglu1-mesa / libgomp1 / libasound2 /
libdbus-1-3 / libsndfile1 / libfontconfig1 / libfreetype6。少任何一个都会在启动阶段
报 `error while loading shared libraries`，而 `blender --version` 可能仍然通过。

实测：320×180 / 5 帧 / cycles / 4 samples，提交到出片约 8 秒，产出 h264 mp4 + 3 张关键帧。

### 视频出片

标准方舟的 `ARK_API_KEY` 已失效（`The API key doesn't exist`），但设置页仍显示「已配置」，
所以失败时会在错误信息后面追加两条可操作出路（换 Key / 改用 APIMart 的 Seedance 条目），
避免用户对着上游原文猜。APIMart 的 `catalog-apimart-seedance-1-0-pro-fast` 实测可出片。

### Chromium（发布台）

用 `npx playwright-core install --with-deps chromium` 安装，装到 `/ms-playwright`，
由 `PLAYWRIGHT_BROWSERS_PATH` 固定该路径。**不要装 apt 的 chromium**：CDP 版本与
playwright-core 不匹配会直接启动失败。`resolveChrome()` 增加了对 Playwright 浏览器目录的扫描
（目录名带版本号，只能扫），找到的是 `chromium-<rev>/chrome-linux64/chrome`。

两个必须注意的点：

1. **root 下必须 `--no-sandbox`**，否则 Chromium 拒绝启动。容器本身就是隔离边界，
   再加一层沙箱没有必要。由 `chromiumSandboxArgs()` 统一提供，登录/会话校验/上传队列共用。
2. **没有桌面（无 `DISPLAY`）时不能扫码登录**。`openLoginWindow` 会直接返回
   `status: no-display` 并给出提示，而不是打开一个没人能扫码的窗口然后等 5 分钟超时。
   可行的做法是在有桌面的机器登录一次，把 `.publish-profiles/<账号>/` 整个拷过来；
   之后无头的会话校验和草稿上传都能复用这份登录态。

`/api/publish/health` 现在多两个字段：`desktopAvailable`（能否弹窗）和 `loginHint`（不能时的说明）。

### 孤儿产物清理

删项目按规范只删项目目录，共享产物池（generated/videos/voices/exports）不删——
那里是扁平命名，文件可能与已发布内容关联。所以残留文件靠脚本按「是否还被引用」回收：

```bash
docker exec storyboard-app-1 node scripts/cleanup-orphan-media.mjs          # 预演
docker exec storyboard-app-1 node scripts/cleanup-orphan-media.mjs --apply  # 真删
```

引用来源是数据库（characters/assets/designs/shots/deliverables）+ 全部项目目录下的 JSON 文件；
`publish-packages` 是交付物，不参与回收。注意脚本在**镜像里**，改了要重建镜像才生效。
