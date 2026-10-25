# Tasks

## 1. 技能与契约基础

- [x] 1.1 在 `src/api.ts` 的 `Stage` 与 `STAGES` 中加入 `creative`，并在 `src/skills/stages.ts` 的 `STAGE_RUNTIME` 补齐条目；验证：`npm run build` 的 `tsc --noEmit` 通过，且 `node verify-skills-unit.mjs` 仍通过
- [x] 1.2 在 `src/skills/parse.ts` 的 `STAGES` 白名单加入 `creative`；验证：新建一个 stage 为 `creative` 的技能文本能被解析，非法 stage 仍报错（在 `verify-skills-unit.mjs` 增补断言）
- [x] 1.3 在 `src/skills/contracts.ts` 实现 `reverse-v1` zod schema（source / global_style / shots[] / negative_prompt / notes，含时间范围与必填字段校验）并注册；验证：新增 `verify-creative-reverse-contract.mjs`，覆盖合法样本、缺字段、时间倒置三类
- [x] 1.4 在 `src/skills/tools.ts` 的 `KNOWN_TOOL_IDS` 加入创意工具 id（`read_creative_session`、`read_creative_source`、`read_video_shots`、`read_frame_detail`、`ingest_source`、`probe_source`、`split_scenes`、`extract_frames`、`submit_reverse_pack`、`generate_image`、`generate_video`、`generate_voice`）；验证：`node verify-skills-unit.mjs` 与 `node verify-skills-api.mjs` 通过
- [x] 1.5 新建 `skills/video-reverse/SKILL.md`（frontmatter：stage creative、runtime json-tools、tools 声明读工具 + 媒体工具 + `submit_reverse_pack`、contracts `[reverse-v1]`），正文写逐镜反推规则与两段提示词分工；验证：`verify-skills-real.mjs` 能加载该技能且占位符与 inputs 一致
- [x] 1.6 新建 `skills/creative-plan/SKILL.md`（策划模式：把一句想法拆成方向、节奏与镜头草案，不产出 `reverse-v1`）；验证：设置页技能列表能看到两个新技能，恢复默认不报错

## 2. 创意存储与会话 API

- [x] 2.1 在 `server/db.mjs` 增加 `creative_sessions`、`creative_threads`、`creative_sources`、`creative_shots`、`creative_artifacts` 五张表的建表语句，保持 `CREATE TABLE IF NOT EXISTS` 且不动现有表；验证：删除临时库后启动，`PRAGMA table_info` 能列出五张表
- [x] 2.2 在 `server/creative.mjs` 实现会话 CRUD（创建、列表按 `updated_at` 倒序、重命名、删除）与线程读写；验证：新增 `verify-creative-session.mjs` 覆盖增删改查与排序
- [x] 2.3 在 `server/creative.mjs` 实现线程 1MB 上限，超限返回 `thread-too-large` 且不写库；验证：脚本写入超限消息后断言旧内容仍在
- [x] 2.4 在 `vite.config.ts` 增加 `/api/creative/sessions`、`/api/creative/sessions/:id/thread`、`/api/creative/promote` 的薄路由，业务逻辑全部委托 `server/creative.mjs`；验证：`node verify-creative-session.mjs` 走 HTTP 完成一轮读写
- [x] 2.5 实现 `creatives/<sessionId>/` 目录创建与删除清理，并把 `creatives/` 加入 `.gitignore`；验证：删除会话后目录消失，其他会话目录存在
- [x] 2.6 在 `src/creative/sessionStore.ts` 封装会话与线程的前端 API（列表、创建、改名、删除、加载、保存）；验证：`verify-creative-session.mjs` 的前端分支用真实接口跑通

## 3. 摄取层（P1：上传与直链）

- [x] 3.1 新建 `server/ingest.mjs`，定义 `IngestAdapter` 接口与注册表，未启用的适配器返回可读 `unavailable` 原因；验证：`verify-creative-ingest.mjs` 断言默认只有 upload/direct 可用
- [x] 3.2 实现 upload 适配器：接收 base64 或临时文件，校验扩展名与 200MB 上限，写入源目录并返回 `sourceId`；验证：脚本上传一段 2 秒样例视频后能读到文件与记录
- [x] 3.3 实现 direct 适配器：流式下载、校验 `content-type` 与大小、拒绝 `localhost`/内网/非 http(s) 地址（SSRF 防护）；验证：脚本对 `http://127.0.0.1` 与伪造大文件均返回拒绝
- [x] 3.4 实现 probe：调用 ffprobe 记录时长、宽高、帧率、码率、编码与是否有音轨；验证：无音轨样例被标记 `hasAudio=false`，损坏文件返回可读错误
- [x] 3.5 实现源记录与平台元数据字段（platform、platformId、author、title、url、cover），缺失字段留空不伪造；验证：只传 URL 的源记录保存成功且界面取值不报错
- [x] 3.6 在设置中增加摄取配置读取（`creative.ingest`），未配置时保持默认；验证：`verify-creative-ingest.mjs` 覆盖缺省与显式配置两种

## 4. 视频分析（probe / 切分 / 抽帧）

- [x] 4.1 新建 `server/video-analyze.mjs`，封装 ffprobe 与抽帧工具函数，复用现有 ffmpeg 探测顺序；验证：脚本对样例视频返回正确时长与帧数
- [x] 4.2 实现场景切分：输出连续、首尾相接、无重叠的镜头段，短于阈值的段并入相邻段；验证：`verify-creative-analyze.mjs` 断言首段从 0 开始、末段结束于总时长、相邻段 `end === next.start`
- [x] 4.3 实现证据帧抽取：每镜至少一张，支持指定时点与批量，越界时点夹紧并记录实际时间；验证：脚本断言每镜帧文件存在且时点在范围内
- [x] 4.4 实现 `/api/creative/analyze` 的 `split` 与 `frames` 动作，返回镜头段、帧路径与耗时；验证：HTTP 调用成功并写入 `creative_shots`
- [x] 4.5 实现切分灵敏度参数与「重新切分」：旧帧与旧提示词标记过期而不删除；验证：脚本改阈值重跑后旧帧仍在、状态为过期
- [x] 4.6 抽取源封面（首帧或指定帧）供会话卡片使用；验证：源卡片能显示封面且文件存在

## 5. 创意会话界面

- [x] 5.1 新建 `src/creative/CreativeChat.tsx`，复用 `useAgentMessages`、`runStageAgent`、`ChatThreadShell`、`ChatThreadBody`、`WorkbenchHeader`、`StageToolUis`，不实现 `WorkbenchChatAdapter`；验证：`npm run build` 通过，单会话可发送并收到回复
- [x] 5.2 实现会话列表侧栏：新建、重命名、删除确认、按最近更新排序；验证：`verify-creative-ui.mjs` 覆盖四个动作
- [x] 5.3 实现会话自动标题（首条用户消息摘要）与手动改名持久化；验证：刷新后标题保持
- [x] 5.4 在 `src/App.tsx` 增加第八个视图「创意」，`view` 联合类型与 `changeView` 一并扩展；验证：`verify-workbench-chats.mjs` 与新增 UI 脚本都能导航到创意
- [x] 5.5 创意视图下全局带隐藏项目与集选择器，保留导航与全局工具；验证：`verify-creative-ui.mjs` 断言这两个选择器不存在且切换项目不影响会话
- [x] 5.6 实现模式切换（策划 / 反推 / 复刻），切换保留消息与产物并只启用当前模式工具；验证：脚本切换后历史仍在、工具列表随模式变化
- [x] 5.7 实现消息中的源视频卡、镜头卡、提示词包卡与生成结果卡（复用 `ChatMessage` / `ChatStep` 视觉语言）；验证：`verify-creative-ui.mjs` 断言四类卡片可渲染并带动作按钮
- [x] 5.8 实现空态、窄屏抽屉与运行中取消；验证：UI 脚本在窄视口下会话列表收起、对话仍在主位

## 6. 反推链路

- [x] 6.1 在 `src/creative/tools.ts` 实现会话读工具（`read_creative_session`、`read_creative_source`、`read_video_shots`、`read_frame_detail`），只读当前会话状态；验证：`verify-creative-reverse.mjs` 断言工具返回镜头与帧引用且不含二进制
- [x] 6.2 实现媒体工具封装（`ingest_source`、`probe_source`、`split_scenes`、`extract_frames`），调用 `/api/creative/*` 并回写会话状态；验证：脚本从链接到帧文件完整跑通一次
- [x] 6.3 实现逐镜视觉理解：按档位选取证据帧，调用 `/api/vision`，失败可重试且不丢已完成镜头；验证：脚本用桩数据断言每镜都产生结构化中间结果
- [x] 6.4 实现 `submit_reverse_pack`：校验 `reverse-v1` 后写 `creative_artifacts`，不合法返回可读错误；验证：非法样本被拒绝且不落库，合法样本落库
- [x] 6.5 实现增量重算：按镜头索引只重算指定镜头，保留其他镜头与证据；验证：脚本重算第 3 镜后第 1、2 镜内容不变
- [x] 6.6 实现证据查看：镜头展开显示证据帧、时间点与置信度；验证：UI 脚本能打开证据面板并看到不少于一张图
- [x] 6.7 在创意会话中接入反推技能：模式为「反推」时绑定 `video-reverse` 的读工具与 `submit_reverse_pack`；验证：真实一轮对话产出通过契约的提示词包

## 7. 导出与晋升

- [x] 7.1 实现提示词包导出：JSON（通过 `reverse-v1` 校验）与可读文本（按镜分组、无内部 ID）；验证：`verify-creative-export.mjs` 断言两种导出内容完整且 JSON 可再次校验
- [x] 7.2 在 `server/creative.mjs` 实现晋升映射（reverse 字段 → ProjectShot，`seconds` 取时间差，证据与来源写入 `extra`）；验证：脚本晋升后读取项目镜头，字段逐项匹配
- [x] 7.3 实现晋升目标选择：新建项目或写入现有项目，均需确认弹窗；验证：UI 脚本覆盖确认与取消两条路径
- [x] 7.4 晋升到现有项目时保留已有镜头的手改提示词与参考，只追加或按稳定 `shotId` 更新；验证：脚本预置手改镜头后晋升，断言手改字段未被覆盖
- [x] 7.5 实现晋升失败的回滚：项目写入失败时不留下半成品项目或部分镜头；验证：脚本注入失败后项目列表不变

## 8. 可选下载适配器

- [x] 8.1 实现 `yt-dlp` 适配器：可执行文件定位、参数白名单、超时与输出目录约束；验证：`verify-creative-adapters.mjs` 在未安装时返回可读禁用原因，安装后用样例链接成功摄取
- [x] 8.2 实现 DTK HTTP 适配器：只依赖 `parse_url` 与 `download_media` 两个端点，支持 Base URL 与 Key；验证：脚本用本地桩服务断言请求路径、鉴权头与失败错误
- [x] 8.3 在设置页增加「创意下载」区块：启用开关、yt-dlp 路径、DTK 地址与 Key、连通性测试；验证：`verify-creative-settings.mjs` 覆盖保存、读取与测试结果
- [x] 8.4 确保平台 Cookie/Key 不进入聊天消息、线程记录与错误文本；验证：脚本在错误路径中断言响应与消息中不含凭据原文
- [x] 8.5 实现适配器失败不静默回退：已启用适配器失败时返回明确错误，不自动改用其他适配器；验证：脚本断言错误类型与提示文案

## 9. 能力托盘与生成闸门

- [x] 9.1 在 `AppSettings` 增加可选 `creative` 配置（`models`、`ingest`、`analysis`、`confirmCost`、`limits`），缺省不写库；验证：`verify-creative-settings.mjs` 覆盖旧设置读取不报错
- [x] 9.2 实现能力托盘：文本、视觉、视频理解、图像、三视图、视频、视频参考、配音分别显示绑定模型与就绪原因；验证：UI 脚本断言未绑定能力显示原因而不是空白
- [x] 9.3 实现托盘换模型：写入 `creative.models` 而不改 `defaults`，并提供「恢复跟随全局」；验证：脚本改托盘后全站默认值不变
- [x] 9.4 实现 `generate_image`、`generate_voice` 工具，复用 `/api/generate` 与 `/api/voice`，结果写成会话卡片；验证：桩模式下断言请求体、模型键与卡片字段
- [x] 9.5 实现 `generate_video` 工具，复用 `/api/seedance`；验证：桩模式下断言首帧、参考与提示词传递正确
- [x] 9.6 实现成本确认卡（调用次数、模型、单价、合计）与会话级「不再询问」；验证：UI 脚本断言未确认时不发请求、确认后只发一次
- [x] 9.7 实现 `creativeLimits`（`maxShots`、`maxFramesPerShot`、`maxPaidCallsPerTurn`）并在超限时拒绝；验证：脚本触发上限后返回可读错误且无请求发出
- [x] 9.8 实现 Seedance 2.0/2.5 每次强制确认，不受「不再询问」影响；验证：脚本在已勾选跳过的情况下仍要求确认
- [x] 9.9 实现原片证据帧与生成结果的按镜对照；验证：UI 脚本断言同屏出现两列且差异说明非空

## 10. 集成验收与文档

- [x] 10.1 端到端：本地上传一条 10–15 秒视频 → 切分 → 抽帧 → 反推 → 导出 → 晋升新项目，全流程无手工改库；验证：新增 `verify-creative-e2e.mjs` 一次跑通并输出摘要
- [x] 10.2 回归五个工作台：剧本、角色、素材、镜头表、提示词的聊天与保存行为不变；验证：依次运行 `verify-workbench-chats.mjs`、`verify-workbench-builtin-actions.mjs`、`verify-script-chat.mjs` 全部通过
- [x] 10.3 回归项目上下文：创意视图切换项目不重载会话，项目视图切换项目仍正常；验证：`verify-project-scope.mjs` 与 `verify-creative-ui.mjs` 同时通过
- [x] 10.4 编写 `docs/creative-studio.md`：能力边界、摄取配置、成本规则、合规说明、故障排查；验证：文档中的命令逐条可执行
- [x] 10.5 更新 `README.md` 的界面骨架与视图列表（七视图 → 八视图），说明创意视图不绑定项目；验证：README 描述与界面一致
- [x] 10.6 运行 `npm run build` 与 `openspec validate creative-chat-studio --strict`；验证：两者均通过

## Workflow follow-up

- 归档前先运行 `openspec sync-specs` 更新主规格，再执行 `openspec archive creative-chat-studio`。
- 归档后复查 `creatives/` 与五张新表在全新库上的首次创建路径。
