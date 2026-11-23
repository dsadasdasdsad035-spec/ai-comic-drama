# Proposal

## Why

现在的提示词只有「生成」这一个入口：模型按分镜写一版，用户没有可对照的写法样本，也很难判断「一镜到底的运镜该怎么写」。同时仓库里已经散落着三份互不相通的经验——`skills/byted-sol-seedance-prompt` 的写作原则与三个示例、`reverse-v1` 契约与晋升链路（服务端能力齐备但界面入口在 dsh 迁移时被删）、以及 `camera-moves-whitebox-132` 那种「素材 + 说明」的浏览形态——但它们都停在「规则」或「空壳」上，没有一处能让人**挑一条现成写法、读它、套到自己镜头上**。

外部站点（vflow.live 等）已经积累了一万多条带原片的公开提示词案例，`rea-video` 又能把用户自己的参考片拆成逐镜提示词。这两类东西本质是同一份数据的不同来源，缺的只是一个能同时装下它们、并能写回镜头的容器。

## What Changes

- **素材页新增「提示词案例」Tab**（第 7 个），全局作用域：所有项目共用一份案例库，卡片浏览 + 详情 + 搜索筛选 + 收藏。
- **外部案例导入**：对接 vflow.live 的公开索引，先预览再勾选入库；`flatkey` 等其他站作为可选来源登记，默认关闭。只存外链封面/视频，不下载媒体。
- **自有片反推**：选项目视频库里的视频，后台跑 `rea-video` CLI 拆解，把逐镜结果（制作方式、证据、置信度、两段提示词）写进同一个案例库，`source` 标为 `reverse-own`。
- **应用到镜头**：案例的两段提示词可分别写入当前选中镜头的画面提示词与运动提示词；未选镜头时按钮置灰并说明原因。
- **来源与许可留档**：每条案例必须带来源、原文链接、作者与许可口径；外部案例标记为仅参考，反推自有片标记为自有。用户不能把外部案例当本项目产物发布。
- **反推工具配置**：设置页新增 rea-video 可执行文件路径、可用性检测、档位（快速 / 完整）与「本次会触发哪些模型下载」的说明；未安装时反推入口给出可读原因与安装命令，不静默安装。

不在本次范围：不改 `reverse-v1` 契约字段；不恢复旧创意会话的写入路径；不把 `report.html` 直接挂到应用源下；不做自动复刻（`rea-video remake` / capsule-cinema）；不做案例的多用户共享或云端同步。

## Capabilities

### New Capabilities

- `prompt-case-library`: 提示词案例的存储、来源登记、导入预览、浏览筛选、详情查看、应用到镜头、来源与许可留档、删除与收藏。含外部站点导入适配器与自有片反推产物入库。
- `video-reverse-analysis`: `rea-video` CLI 的可执行文件探测、作业队列（子进程 / 超时 / 停滞 / 取消 / 并发）、档位到命令行参数的映射、VLM 环境变量注入、`breakdown.json` 到案例逐镜结构的解析，以及拆解产物的媒体落盘。

### Modified Capabilities

无。`shot-video-prompt` 与 `shots-workbench` 的写回语义不变：应用案例只是把文本写进镜头的现有字段，不新增手改快照规则。

## Impact

- 数据库：`server/db.mjs` 新增全局表 `prompt_cases`（无 `project_id`，与 `settings` / `skill_installs` 同层）。老库走 `CREATE TABLE IF NOT EXISTS` 自动补建，不改现有表。
- 服务端：新增 `server/prompt-cases.mjs`（外链导入、案例 CRUD、rea 产物解析）、`server/rea-video.mjs`（可执行文件探测与作业队列）；`server/app.ts` 增加 `/api/prompt-cases/*` 路由；复用 `server/ingest.mjs` 的 `assertPublicUrl` 做抓取前 SSRF 校验。
- 前端：`src/AssetBoard.tsx` 增 Tab 与上下文带；新增 `src/promptCases/`（卡片、详情、导入弹窗、反推进度）；`src/App.tsx` 接线「应用到镜头」；`src/settings/` 增反推工具配置块。
- 依赖与部署：新增外部进程依赖 `rea-video`（Python ≥ 3.10 + ffmpeg + onnxruntime）。`DEPLOY-CHECKLIST.md` 的硬阻塞条目 +1，桌面端与 Docker 镜像都需要带 Python 运行时；设置页必须能显示「找不到可执行文件」的原因。
- 网络：服务端会访问 `www.vflow.live` 的公开索引与 `pbs.twimg.com` 的封面外链。索引约 5 MB，缓存 10 分钟；外链封面只交给浏览器加载，不走服务端代理。
- 验收：新增 `verify-prompt-cases.mjs`（mock vflow 与 rea-video 子进程）；`npm run build` 与既有 `verify-skills-unit.mjs` 必须保持通过。
