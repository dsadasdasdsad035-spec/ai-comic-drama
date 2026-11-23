# 创意工作室（旧版 Pi 实现，已停用）

> **本文描述的是旧版创意工作室（应用内 Pi 聊天），已被 `creative-studio-dsh-runtime` 换掉。**
> 当前创意页是 `/studio/`（宿主前端），部署与排障见 [`creative-host.md`](./creative-host.md)。
> 这里保留的是历史行为说明：旧会话仍可查看与导出（写入一律 410），旧表仍被保留。

创意会话是 **Pi 纯聊天**：多会话列表保留，消息写入 `creative_threads`。

- **默认（无专家）**：Pi 用 **`list_installed_skills`** 发现 Agent 包，再用 **`read_skill_text`** 读 SKILL；顶栏「偏好」可指定默认包。
- **专家模式**（顶栏「专家」下拉）：system **仅**专家 `soul`（编译进 DSH 前会去掉旧版 `{{…}}` 占位符），工具/技能受专家白名单约束；系统始终注入 **`list_experts`**。专家定义在 **设置 → 创意专家**（内置 + 自定义，可 JSON/zip 导入导出）。会话可绑定 `expert_id`，列表侧栏显示专家名。

模型在 **默认路由 · 创意（对话助手）**。勾选「创意聊天」的 **HTTP MCP** 经 `/api/mcp` 进入专家工具白名单（stdio 暂不支持）。

## 入口与边界

- 顶栏「创意」视图；不绑定项目集号（无集选择器）。
- 会话存储：`creatives/<sessionId>/` 与 SQLite `creative_*` 表；列表按顶栏当前 **`project` 过滤**，新建会话自动写入该项目。`project` 为空的旧会话不会出现在项目创意视图中。
- 技能：设置 → SkillHub 安装 Agent 包；创意顶栏偏好可选，留空即 **自动（技能目录）**。

## 使用方式

1. 设置 → **默认路由** →「创意（对话助手）」绑定文本模型。
2. （可选）SkillHub 安装 Agent 包；顶栏偏好留空或指定默认 id。
3. （可选）设置 → **MCP**：安装 HTTP 服务并勾选「创意聊天」。
4. 发送消息 → `runStageAgent`（Pi Agent）→ **历史走 Pi `messages`，按原文完整送入**（工具结果不折叠、不截断，直到清空或新建会话），本轮 user 仅正文；模型按 system 先 **`list_installed_skills`**（按需）再 **`read_skill_text`**；**平台内置** `read_*` / `submit_*` 始终可用（写回需顶栏已选项目，`submit_*` 内建契约校验），另可调 HTTP MCP。

## 素材与画布动作工具

模型能用名字直接改画布和角色，不用猜节点 id；写动作要顶栏已选项目，缺通道就拒绝并说明原因。

**参考连线是生成的真来源**：`generate_keyframe` 与 `generate_clip` 不另立规则，直接复用画布按钮那套解析（`collectShotReferences` / `buildShotVideoRequest`）。没连线的镜就是纯提示词出图；连线指向的角色没有三视图、素材卡不在画布上时，工具在成本确认之前就失败，不会静默少送一张参考。

| 工具 | 作用 | 失败即拒绝的情形 |
|---|---|---|
| `link_shot_refs` | 给镜号连/断角色与素材参考（`kind: character \| asset`，`action: add \| remove`） | 名字查不到（列出可用名字）、同名素材卡（列出节点 id）、没有画布上下文 |
| `set_shot_camera_lexicon` | 绑定/解绑镜头语言参照，写 `lexicon_ref_key` / `lexicon_ref_url` / `motion_lexicon_as_ref` | 条目名有歧义（列出候选）、找不到镜号；**不建素材卡** |
| `set_character_visual` | 采纳三视图或表情总图（`url` 或 `assetTitle`） | 项目外地址、外链、标题不存在（列出可用标题）、没有角色落库通道 |
| `generate_character_views` | 生成角色三视图（有成本，先确认） | 未确认成本、没有确认通道 |
| `generate_expression_sheet` | 生成 4×2 表情总图并八格裁剪（有成本，先确认） | 同上；无外观锚点也无参考图 |
| `generate_keyframe` | 出首帧：参考图来自该镜画布连线（角色三视图 / 素材图 / 表情，上限 10 张），并在提示词追加参考图说明 | 工位是出片；没有首帧提示词；连线角色没有三视图、素材卡不在画布上（均在成本确认前失败） |
| `generate_clip` | 提交出片：`no`、可选 `prompt`（无手改时本次正文）、`modelKey`、`resolution`（480p/720p，仅本次）；参考由 `buildShotVideoRequest`；正文：手改 → 参数 prompt → `video_prompt` | blocking；只回 jobId |
| `set_shot_video_options` | 写表情参考 / 原生音频 / 工位 | 原生音频未就绪 |
| `set_shot_video_override` | 手改正文保存或清除（须 `read_shot_video_inputs.fingerprint`） | 指纹不符 |
| `set_shot_ref_extras` | 手工参考 URL 增删 | 非项目媒体 |
| `set_shot_neighbor_refs` | 邻镜 `shot-prev`/`shot-next` | 镜不存在 |
| `read_shot_video_inputs` | 出片模式、参考顺序、`fingerprint` | 镜不在画布 |
| `submit_assets` | `assets-v1` 契约批量写素材卡（按 `designId` 或「角色 + 表情总图」去重） | 地址不在项目媒体里（整批拒绝）、空数组 |

格位、裁剪坐标与 `identityFingerprint` 由系统计算，调用方给的坐标与指纹一律忽略。单格裁剪失败不会丢总图，结果里点名失败情绪。

## 消息渲染

助手与用户消息的文本都走 `ChatText`（`src/chat-ui/ChatText.tsx`），与 3D 调度会话、技能会话共用同一套契约：

- **支持的语法**：标题、粗体/斜体、删除线、行内代码、无序/有序列表、引用块、链接、表格、任务列表。
- **代码块**：三反引号围栏渲染为可折叠块（默认收起），显示语言与行数；未标注语言时回落为 `text`。流式输出到一半的未闭合围栏也按代码块处理。
- **表格**：外层为横向滚动容器，宽度不足时表格自身横向滚动，不撑破会话面板。
- **换行**：单个换行保留为换行，模型的多行说明不会被合并成一段。
- **安全**：原始 HTML 不作为标签执行，按纯文本显示；`javascript:` 链接被清空；外链在新窗口打开且不带 referrer。
- **前缀优先**：`第 N 轮`、`已取消`、`失败：`、`模型说明：` 等前缀由会话的专用组件先行匹配，不会进入 Markdown 渲染。

## 检查器

「查看将发送」展示下一轮 system / 合成 user / 技能声明的工具列表（含 manifest 中尚未实现的名称，供你对照）。

## 服务端创意 API

摄取、反推、产物等 **HTTP API 仍留在仓库**，供脚本与后续技能扩展；当前 UI 不挂载这些能力。若要恢复，需在 `stageTools` 或独立模块重新注册并在创意页绑定。

## 工具声明的热更新边界（当前 dsh 宿主）

工具声明由 `src/agent/stageTools.ts` 的 zod schema 推导，经 `server-build/studio-tools.mjs`
打进应用进程，再由 `/api/studio/tools` 暴露给宿主插件。

| 改动 | 生效方式 |
|---|---|
| 参数 / 描述（zod schema、`description`） | 重建 `server-build` 后，宿主下一次工具调用即按新声明校验，**不用重启宿主** |
| 工具函数体（`run()` 的实现） | 重建 `server-build` 后由工具桥按产物时间戳自动重载模块，下一次调用即生效，**应用与宿主都不用重启** |
| 工具增删 | 重建后由清单版本差异触发宿主重注册 |

### 实现热更为什么不用重启

`StudioToolBridge.ensureLoaded` 每次加载前 `stat` 一次 `server-build/studio-tools.mjs`，
时间戳变了就以 `?v=<mtime>` 重新 `import` —— ESM 的模块缓存按 URL 区分，
换 URL 即可拿到新模块，然后整表重建工具（旧表里的 `run` 闭包指向旧模块）。

约束：`npm run build:server` 必须真正改写产物（内容有变）。时间戳没变就不会重载，
所以「改完忘了构建」的表现仍是旧实现，这一点与改动前一致。

`/api/studio/tools` 的响应带 `version`（对排序后的 `name + description + parameters` 取
sha256 前 12 位）。宿主插件 `creative-tools` 在每次 `tools/pre-execute` 与 15 秒兜底轮询时
比对它，变了才「先摘后装」换表；因此：

- 注册表按名字唯一，同名工具无法并存 —— 换表只能先注销再注册；
- 换表失败会回滚到上一版定义，不会把工具清空；
- 有调用正在执行时不换表，否则进行中的调用会丢掉自己的定义；
- 旧服务端不返回 `version` 时，插件退化为「启动时拉一次」，行为与改动前一致。

## 验收

```bash
# 宿主侧的自动化验收（Node 24，无需渠道 Key）
node tests/studio-flow-smoke.mjs      # 拉起宿主 / 工具数量与清单一致 / 技能可读 / 压缩已开
node tests/studio-shell.mjs           # 外壳：入口、主题桥、错误态与重试
node tests/legacy-storage.mjs         # 旧会话只读：写入一律 410
node verify-skills-unit.mjs           # 技能与工具单元测试总入口
node verify-creative-builtin-tools.mjs  # 逐项 invoke 全部平台工具（无确认通道时必须 fail-closed）
```

模型回合（真正生成回复、出图出片）需要渠道 Key 与计费，只能手测。