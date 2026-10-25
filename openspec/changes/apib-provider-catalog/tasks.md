# Tasks

## 1. 数据模型与预置

- [x] 1.1 在 `src/api.ts` 增加 `apimart` 渠道类型、`ModelFeatureSet`、`ModelEntry.caps/features/source` 与只读 `keyAvailable` 类型；运行 `npx tsc --noEmit`，确认旧字段未受影响。
- [x] 1.2 新建共享谓词 `src/modelCaps.ts`（`modelHasCap`、`isRunnableModel`、`modelCapsLabel`），并用 `verify-model-caps.mjs` 覆盖旧 `cap`、新 `caps`、`videoRef` 与 `view` 四种情况。
- [x] 1.3 在 `vite.config.ts` 增加 APIMart 预置渠道与 8 个已接入运行时的预置模型，`CURRENT_PRESETS_VERSION` 升到 9（开发库已漂移到 6/7/8，用 9 修复一次）；用设置夹具验证第二次读取不重复、已有 `defaults` 不变。
- [x] 1.4 扩展 `normalizeSettings` 读取并清洗 `caps/features/source`，保留未知字段；用 `verify-settings-db.mjs` 的读写往返确认旧配置不丢字段。
- [x] 1.5 在 `/api/settings` 响应附加服务端计算的只读 `keyAvailable`，保存时忽略该字段；用一次 GET/PUT 验证设置库 Key 与环境变量 Key 两种来源。

## 2. APIMart 协议模块

- [x] 2.1 新建 `server/apimart.mjs`，实现 `ApimartError` 与 402/401/429/超时映射；用 `verify-apimart-errors.mjs` 的 mock 响应覆盖每种状态码。
- [x] 2.2 实现 `fetchCatalog` 与 `mapCatalogEntry`（chat/image/video/audio → `suggestedCaps` 与 `runtime`）；用目录夹具覆盖带视觉标签的 chat、image、video、TTS、Whisper。
- [x] 2.3 实现 `uploadImage`（multipart 字段名 `file`、Bearer 头、20MB 限制）；用 mock fetch 验证请求格式与 413/401 错误映射。
- [x] 2.4 实现 `submitImage`、`pollTask`、`downloadResult`，支持 completed/failed/cancelled、超时与取消；用 `verify-apimart-image.mjs` 覆盖四种终态。
- [x] 2.5 实现 Seedance 2.5 / Kling v3 专用 payload 与通用视频 payload：首帧、尾帧、参考图、参考视频、本地参考视频拒绝；用 `verify-apimart-video-payload.mjs` 覆盖专用族与通用字段。
- [x] 2.6 实现 `synthesizeSpeech`：JSON 错误识别、二进制落盘、未知音色回落 `alloy`；用 `verify-apimart-tts.mjs` 覆盖成功/未知音色/错误 JSON。
- [x] 2.7 新增 `docs/apimart.md`，记录 Base URL、Key 环境变量、402 余额语义、已接入能力与视频族边界；按文档中的命令逐条核对可读性。

## 3. 服务端接线

- [x] 3.1 在 `providerKey` 与 `capsOfKind` 增加 `apimart` 分支（`APIB_API_KEY` → `APIMART_API_KEY`，不回退方舟）；用 `verify-apimart-key.mjs` 覆盖设置库/环境变量/缺失三种情况。
- [x] 3.2 新增 `POST /api/provider-catalog`，接受草稿 `provider`，返回目录条目与 `suggestedCaps/runtime`；用 mock 上游验证 200/402/401 与不写设置库。
- [x] 3.3 修改 `/api/text`：APIMart 非流式解包 `{code,data}`，流式在 `ChatStreamParser` 前归一化，且不发送 `thinking`；用 `verify-apimart-text.mjs` 覆盖裸响应、包装响应、包装 SSE。
- [x] 3.4 修改 `/api/vision`：加入 `apimart` 白名单并校验模型 `vision` 能力；用 mock 验证声明/未声明两种请求。
- [x] 3.5 修改 `/api/images`：APIMart 走上传参考图 → 提交任务 → 轮询 → 下载 → 保存；用 `verify-apimart-image-route.mjs` 覆盖文生图、带参考图、失败、取消。
- [x] 3.6 修改 `/api/seedance`：Seedance 2.5 / Kling v3 走专用适配器，其余生成型视频模型走通用 schema 适配；编辑/动作控制模型与本地参考视频返回 `unsupported`。
- [x] 3.7 修改音频分发与 `/api/voices`：APIMart 走 `/audio/speech` 并返回 6 个音色；用 `verify-apimart-tts-route.mjs` 验证合成与音色切换。
- [x] 3.8 修改 `/api/test-provider`：APIMart 用 `/models` 或 1-token 对话测试，402 显示余额不足、401 显示鉴权失败；用 `verify-apimart-test.mjs` 覆盖三种结果。
- [x] 3.9 把 `pickModel`、`pickVideoModel`、`pickVisionModel`、`pickVideoVisionModel` 改为 `modelHasCap`，并拒绝 `runtime=catalog-only` 的模型；用 `verify-model-routing.mjs` 覆盖旧 `cap` 与新 `caps` 路由。
- [x] 3.10 让 `/api/seedance` 的 dryRun 在 APIMart 分支回显族名、payload 与参考素材解析结果；用一次 dryRun 验证不发起真实任务。

## 4. 设置页 UI

- [x] 4.1 新建 `src/settings/` 外壳（左侧导航 + 渠道/模型/默认路由/高级面板），`src/Settings.tsx` 保持默认导出；用 Playwright 打开设置页并确认四个分组可切换。
- [x] 4.2 渠道面板改为每个渠道一张卡，支持用途 chips、添加渠道预设菜单、移除用途/删除渠道的影响提示；用 `verify-settings-providers.mjs` 验证多渠道只渲染一次。
- [x] 4.3 模型库改为一表一模型，支持搜索、渠道筛选、能力筛选、能力编辑、来源与运行状态标记；用 `verify-settings-models.mjs` 覆盖多能力行与目录未接入行。
- [x] 4.4 新增目录同步弹窗：分类 tab、已存在/新增标记、全选、`suggestedCaps` 预览、同步结果计数与 402 提示；用 `verify-settings-catalog.mjs` 以 mock 目录验证首次/重复/失败。
- [x] 4.5 默认路由改为“渠道 → 模型”两级选择，环节默认支持“跟随文本默认”，失效默认模型显示警告；用 `verify-settings-routing.mjs` 覆盖切换渠道、空渠道、失效默认。
- [x] 4.6 增加顶部状态条（缺 Key/余额不足/失效默认）与固定保存栏、未保存提示；用 `verify-settings-status.mjs` 验证三种状态与保存后重算。
- [x] 4.7 处理窄屏横向标签、键盘焦点与主题切换；运行 `node verify-style.mjs` 并截图检查 1600/900 两个宽度。
- [x] 4.8 清理 `src/theme.css` 中重复的设置页样式块，补齐 `.settings-shell/.st-nav/.st-panel` 等新样式；用 `grep` 确认无重复选择器定义，并运行 `node verify-style.mjs`。

## 5. 兼容与回归

- [x] 5.1 用旧设置夹具（单能力模型、缺 `caps` 渠道、已保存文本/图像默认）验证加载后行为不变、默认值不被 APIMart 覆盖；把夹具与断言加入 `verify-settings-db.mjs`。
- [x] 5.2 更新依赖 `.st-*` 选择器的 `verify-providers.mjs`、`verify-settings-db.mjs`、`verify-stage-models-ui.mjs`、`verify-video-ref-ui.mjs`、`verify-agent-limits.mjs`、`verify-skill-settings.mjs`、`verify-deepseek-flash.mjs`、`verify-code-settings.mjs`、`verify-asset-board.mjs`，逐个运行确认通过。
- [x] 5.3 新增 `verify-settings-ui-v2.mjs` 覆盖设置页信息架构、目录同步、两级默认路由与状态条；在本地 dev server 上运行通过。
- [x] 5.4 更新 `README.md` 或 `DEPLOY-CHECKLIST.md` 的渠道说明，加入 APIMart Base URL、`APIB_API_KEY` / `APIMART_API_KEY`、余额 402 与已接入视频族边界；按文档步骤核对一遍。
- [x] 5.5 运行 `npx tsc --noEmit`、`npm run build` 与 `node verify-settings-db.mjs`，确认类型、构建和设置页回归全部通过。

## Workflow follow-up

- 充值 APIMart Key 后运行 `node verify-apimart-live.mjs`（文本 1-token、图像 1K、视频 4 秒、配音一句），记录真实结果。
- 实测 APIMart 视觉 chat 是否接受 `image_url` content parts；若不接受，把 APIMart 视觉模型标记为未验证，不阻塞文本/图像/视频。
- 接入完成后轮换本次对话中出现过的 Key，并确认仓库与日志中没有明文 Key。
- 所有任务与实测通过后，按项目评审要求归档本变更。
