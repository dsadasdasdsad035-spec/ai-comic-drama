# Tasks

## 1. 成片版本数据层

- [x] 1.1 在 `server/db.mjs` 增加 `deliverables`、`publish_accounts`、`publish_jobs`、`publish_events` 四张表（`CREATE TABLE IF NOT EXISTS`，纯增量，不改现有表）；验证：用临时目录初始化数据库两次，`PRAGMA table_info` 能看到四张表且第二次不报错、旧项目读写不受影响。
- [x] 1.2 新增 `server/deliverables.mjs` 与 `server/deliverables.d.mts`：实现创建成片（按项目 + 集自增 `version`）、按项目/集查询、按 id 读取、更新发布配置、删除；验证：单元脚本连续创建三条同集成片得到 v1/v2/v3，换集从 v1 开始，查询只返回当前项目当前集。
- [x] 1.3 在 `/api/assemble` 成功分支写入成片记录，并把 `deliverable` 对象加入响应；导出请求缺少项目或集时仍导出但不写记录；验证：调用 `/api/assemble` 导出后 `GET /api/deliverables?project=&episode=` 能查到该条，响应含 `deliverable.id`；缺项目时响应无 `deliverable` 且不新增记录。
- [x] 1.4 新增 `POST /api/deliverables/import`（原始请求体 + `X-File-Name`）：校验 `.mp4` 扩展名、2GB 上限、ffprobe 可读，落盘到 `public/exports/imports/` 后写记录；验证：导入一个有效 MP4 返回时长与分辨率，导入 `.txt`、损坏 MP4、超过上限的文件分别返回 4xx 且记录数不变。
- [x] 1.5 新增 `PATCH /api/deliverables/:id` 保存 `config`，服务端只接受已知字段并对长度做上限（标题 200、简介 5000、标签 30 个）；验证：保存后重新 GET 配置完整，超长字段被截断而不是报错，未知字段不落库。

## 2. 平台能力注册与会话

- [x] 2.1 新增 `server/publish-platforms.mjs`：导出抖音、B站、头条的静态能力表（内容类型、可用发布方式、封面比例、标题/简介/标签上限、已知时长与大小上限、后台地址、`manualOnly` 标记）；验证：单元脚本断言三平台各自上限不同、每项都有 `id`/`label`/`modes`，且未声明的平台被拒绝。
- [x] 2.2 新增 `GET /api/publish/platforms` 与 `GET /api/publish/health`；health 返回 Chrome 是否可用、Chrome 路径、ffmpeg 是否可用、哪些适配器未验证；验证：curl 两个端点返回 `ok: true`，把 Chrome 路径改成不存在时可复现 `browserAvailable: false` 且 `adapterReady` 标明不可用平台。
- [x] 2.3 新增 `server/publish-accounts.mjs` 与 `.d.mts`：账号增删查、profile 目录创建（权限 0700）、状态与最近检查时间更新；验证：创建账号后目录权限为 0700，列表接口不返回 `profile_dir`，删除后目录被移除。
- [x] 2.4 新增 `server/publish-browser.mjs`：用 `playwright-core` 的 `launchPersistentContext` 打开有头 Chrome，支持扫码等待、可视窗口登录、登录结果轮询与超时；验证：用本地静态登录页模拟一次成功登录与一次超时，返回 `ok` / `timeout` 两种结果，超时后浏览器进程被关闭。
- [x] 2.5 实现账号接口：`GET /api/publish/accounts`、`POST /api/publish/accounts/connect`、`GET /api/publish/accounts/connect/:loginId`、`POST /api/publish/accounts/:id/check`、`DELETE /api/publish/accounts/:id`；验证：连接流程可轮询到 `done`，检查把未登录 profile 标为 `expired`，删除后列表减少且其他账号不受影响。
- [x] 2.6 会话检查区分「失效」与「无法判断」：明确跳转登录页标 `expired`，网络错误或页面结构未知标 `unknown`，两者都不显示为可用；验证：用 mock 页面分别返回登录页、正常后台、请求失败，三种结果对应三个状态。

## 3. 发布编排、预检与队列

- [x] 3.1 新增 `server/publish-preflight.mjs`：按目标逐项检查成片文件存在、账号可用、发布方式被平台支持、标题/简介/标签上限、所需封面比例、AI 标识确认、已知大小上限，输出 `issues[]`（`level`、`code`、`target`、`field`、`message`）；验证：单元用例覆盖每个阻断码与每条警告，全部通过时返回空数组。
- [x] 3.2 新增 `POST /api/publish/preflight`；服务端以注册表为准，不信任客户端传入的上限；验证：请求里伪造更大的标题上限不改变判定结果，超限标题仍返回阻断。
- [x] 3.3 新增 `server/publish-jobs.mjs` 与 `.d.mts`：创建任务、查询任务与事件、状态迁移校验（非法迁移被拒绝）、终态保护；验证：单元脚本按状态机逐个断言允许与拒绝的迁移，`published` 不能被自动改回 `uploading`。
- [x] 3.4 实现幂等键 `deliverableId|platform|accountId`：存在活动任务时复用它，用户显式「重新发布」时 `run_no + 1` 建新任务；验证：连续两次创建同一目标返回同一 job id；带 `republish: true` 时返回新 id 且旧记录仍在。
- [x] 3.5 新增进程内队列（并发 1）与任务接口 `POST /api/publish/jobs`、`GET /api/publish/jobs`、`GET /api/publish/jobs/:id`、`POST /api/publish/jobs/:id/cancel`、`POST /api/publish/jobs/:id/retry`、`POST /api/publish/jobs/:id/mark-published`；验证：提交三条任务时同时只有一条 `uploading`，取消后该任务变 `cancelled` 且队列继续下一条。
- [x] 3.6 服务重启恢复：启动时把 `queued`/`uploading` 任务改为 `unknown` 并写入「服务重启」事件，不自动重跑；验证：手工把任务置为 `uploading` 后重启进程，状态变 `unknown`，事件表新增一条，任务没有被自动执行。
- [x] 3.7 重试只作用于允许重试的目标（`failed` / `expired` / `unknown`），批量重试不得重新提交已成功目标；验证：一条成片三目标中一个成功两个失败，批量重试只新增两个任务；对成功目标单独重试返回 4xx。

## 4. 平台适配器

- [x] 4.1 定义适配器接口与注册表：`openBackend`、`checkSession`、`uploadVideo`、`fillMetadata`、`saveDraft`、`submitFinal`、`readStatus`，每个适配器声明 `verified` 与 `manualOnly`；验证：接口测试断言缺少必需方法的适配器无法注册，未验证适配器只能产生草稿或人工确认任务。
- [x] 4.2 实现抖音适配器：打开创作后台、校验登录、上传视频、填写标题与简介、设置封面、保存草稿；`submitFinal` 只允许在用户确认任务中调用；验证：用本地 mock 后台页面走通草稿流程并断言最后一步停在草稿页；真实账号只做人工验证。
- [x] 4.3 实现 B站适配器：上传、分区与标签、封面、保存草稿，作品地址读取走后台列表或提交结果；验证：mock 页面断言分区与标签被填入、草稿保存后不出现「立即投稿」点击。
- [x] 4.4 实现头条适配器：上传、标题与简介、封面、保存草稿；页面结构无法确认时返回 `selectors_changed` 而不是猜测点击；验证：mock 页面移走一个选择器后任务以 `failed` + `selectors_changed` 结束，且没有发生最终提交。
- [x] 4.5 适配器共用行为：每次任务记录阶段与耗时、失败保留阶段、遇到验证码/短信验证暂停并等待用户、超时后关闭浏览器；验证：模拟验证码出现时任务停在 `awaiting_user` 并可继续；超时用例关闭了浏览器进程。
- [x] 4.6 平台未验证时的降级：能力表标 `manualOnly` 的平台不创建自动任务，只允许「打开后台」与「导出发布包」；验证：把某平台设为 `manualOnly` 后，提交该平台返回明确提示且不创建任务。

## 5. 发布包与安全边界

- [x] 5.1 新增 `server/publish-package.mjs`：生成 `public/publish-packages/<id>/`，写入 MP4、已准备封面、可用的 SRT、`copy.json`（主文案、逐平台覆写、AI 标识、平台上限说明），系统有 `zip` 时再生成压缩包；验证：生成后目录内含预期文件，`copy.json` 可解析；删除 SRT 后仍能生成其余文件。
- [x] 5.2 新增 `POST /api/publish/packages` 并返回目录与可选 zip 地址；验证：接口返回 200，地址可下载，重复调用生成新目录不覆盖旧目录。
- [x] 5.3 路径白名单：成片、封面、SRT 只接受 `/exports/`、`/videos/`、`/generated/`、`/project-assets/` 下的文件，解析符号链接后仍须在允许根内；验证：`../`、绝对路径、指向外部的符号链接三种输入都被拒绝，正常路径通过。
- [x] 5.4 错误与日志脱敏：统一错误清洗（去掉查询串、token 样式片段），消息截断 500 字符；数据库与任务台账不写 cookie/token/profile 绝对路径；验证：构造含 `?token=abc` 的错误消息，落库与接口返回都不含 `abc`；检查账号表无凭据字段。
- [x] 5.5 在 `.gitignore` 增加 `.publish-profiles/` 与 `public/publish-packages/`；验证：`git status` 不出现这两类目录。

## 6. 发布台界面

- [x] 6.1 新增 `src/publish/types.ts`、`src/publish/api.ts`：对齐服务端能力表、成片、任务、预检与事件的 TypeScript 类型与请求函数；验证：`npm run build` 通过，类型与 `.d.mts` 字段一致。
- [x] 6.2 新增 `src/PublishBoard.tsx` 页面壳：接入 `WorkbenchBar`、三个页签（待发布 / 发布记录 / 平台账号）、空项目与空集状态；验证：`verify-publish-ui.mjs` 断言三个页签可切换，未选项目时显示提示且没有成片卡片。
- [x] 6.3 实现成片列表：按项目/集展示版本、时长、分辨率、导出时间，支持选择、播放与「导入成片」；验证：UI 用例断言两条成片可切换且选中态正确，导入按钮打开文件选择。
- [x] 6.4 实现发布编排四段手风琴（平台与账号、文案、封面、发布方式），默认展开第一个未完成段并显示各段摘要；验证：UI 用例断言初始只展开一段，填写后摘要更新，切换成片后配置按成片恢复。
- [x] 6.5 实现主文案与分平台覆写：字数计数使用平台上限、覆写后主文案变化不覆盖、清除覆写恢复继承；验证：UI 用例修改主标题后确认覆写平台不变、未覆写平台跟随；清除后跟随。
- [x] 6.6 实现 `CoverPicker`：从成片抽四帧、上传图片、按 9:16 与 16:9 分组保存、显示当前分组与缺失比例；验证：选择一帧后对应分组出现缩略图，切换比例分组时预览正确，缺该比例时预检提示可见。
- [x] 6.7 实现 `PublishPreflight` 检查器：阻断与警告分组、点击问题定位到字段、配置变化后防抖重跑；验证：UI 用例构造超限标题看到阻断且发布按钮禁用，修正后按钮恢复；点击问题后对应区块展开。
- [x] 6.8 实现发布方式与确认：保存草稿、立即发布、导出发布包；立即发布每次弹出平台与账号清单，取消后不创建任何任务；验证：UI 用例断言取消后任务列表为空，确认后任务数等于目标数。
- [x] 6.9 实现发布记录：按成片分组展示逐平台状态、打开单平台回执抽屉（事件时间线、作品地址、重试、标记已发布）；验证：UI 用例断言三个平台显示三个独立状态，抽屉按时间显示事件，重试只新增失败目标的请求。
- [x] 6.10 实现平台账号页：账号卡片（平台、显示名、状态、最近检查、能力、自动草稿开关）、连接与重新登录入口、删除确认；验证：UI 用例断言失效账号显示重新登录且发布按钮被阻断，删除需确认，页面不出现 profile 路径。
- [x] 6.11 实现扫码/浏览器登录对话框：二维码或打开窗口两种入口、等待/成功/超时/需人工验证四态、失败可重新获取；验证：UI 用例用 mock 登录接口覆盖四种状态，超时显示重试且关闭对话框后没有遗留运行中任务。
- [x] 6.12 响应式与视觉：1200px 以下成片栏转横条、检查器转底部抽屉，900px 以下单列 + 吸底操作条；只用现有 token，平台色仅用于徽标，状态带文字；验证：`verify-style.mjs` 通过，Playwright 在 1440/1200/900 三个宽度截图确认无控件折行与文字重叠。

## 7. 导出入口与任务台账

- [x] 7.1 `src/Preview.tsx` 导出成功后显示「发布到平台 ->」，把 `deliverableId` 回调给 `App`；没有成片 id 时不显示入口；验证：`verify-preview-captions.mjs` 或新增断言确认导出成功后按钮出现，回调携带 id。
- [x] 7.2 `src/App.tsx` 视图集合加入 `publish`，顶栏导航放在画布与设置之间，并在存在运行中/失败发布任务时显示角标；验证：`verify-publish-ui.mjs` 断言导航顺序与 `aria-current`，任务变化后角标数字更新。
- [x] 7.3 `src/tasks.ts` 增加 `publish` 类型与中文标签，`src/TaskCenter.tsx` 展示发布任务并可取消/重试；验证：单测或脚本断言 `KIND_LABEL.publish` 存在，任务中心对运行中显示取消、失败显示重试。
- [x] 7.4 发布任务与发布记录状态同步：任务结束、取消、重试后记录页同步刷新；验证：UI 用例触发一次失败任务，任务中心与发布记录显示同一状态。
- [x] 7.5 自动草稿开关：账号页开启后，导出成功且预检通过时自动创建草稿任务，否则在成片记录中显示未排队原因；验证：UI/接口用例覆盖成功排队与两种未排队原因，且自动任务状态不会进入已发布。

## 8. 集成验证与文档

- [x] 8.1 新增 `verify-publish-contract.mjs`：覆盖能力表、状态机、幂等键、幂等复用、非法迁移与错误脱敏；验证：`node verify-publish-contract.mjs` 退出码 0。
- [x] 8.2 新增 `verify-publish-api.mjs`（临时库 + mock 浏览器 + mock 平台页）：覆盖成片创建与导入、预检阻断/警告、任务创建与取消、重启恢复、单目标重试、发布包生成、路径穿越拒绝；验证：脚本全部通过且不写真实项目库。
- [x] 8.3 新增 `verify-publish-ui.mjs`：覆盖页签、成片选择、文案覆写、封面分组、预检禁用、确认弹窗取消、记录抽屉、账号失效与登录四态、三个断点；验证：脚本通过并输出截图。
- [x] 8.4 回归既有链路：`npm run build`、`verify-preview-captions.mjs`、`verify-subs.mjs`、`verify-project-scope.mjs`、`verify-workbench-chats.mjs`；验证：构建通过，脚本全绿，顶栏导航与项目/集切换用例未被破坏。
- [x] 8.5 更新 `README.md`：新增发布台章节，写清平台能力边界（哪些是草稿、哪些只能手动）、账号登录与本机 profile、AI 标识、发布包兜底、真实发布的人工验证步骤；验证：按文档能完成一次「导出 → 配置 → 保存草稿」与一次「导出发布包」，command 与界面文案一致。
- [x] 8.6 更新 `DEPLOY-CHECKLIST.md`：说明浏览器自动化要求本机 Chrome 与常驻进程、远程部署只能走发布包、`playwright-core` 在抽取生产服务时需移入 `dependencies`；验证：文档中的检查命令可执行，结论与 `/api/publish/health` 实际返回一致。

## Workflow follow-up

- 真实平台验证清单：抖音、B站、头条各完成一次人工登录与一次草稿保存，记录后台改版导致的失败点；不可验证的平台降级为 `manualOnly` 后再发布。
- 归档前运行 `openspec validate multi-platform-publishing --strict`，确认主 spec 同步后再归档。
- 通过 `/opsx:archive` 归档本变更，归档说明附上验证脚本输出与截图路径。
