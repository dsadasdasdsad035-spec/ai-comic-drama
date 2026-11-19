# Tasks

## 1. 路由命名与归属清单

- [x] 1.1 在 `server/studio-profile.mjs` 增加 `STUDIO_ROUTE_PREFIX = 'sb-'`、`STUDIO_LEGACY_PROVIDER_ID = 'storyboard'` 与 `routeIdForProvider(providerId)`（转小写、非 `[a-z0-9]` 归一为 `-`、折叠连续 `-`、去掉首尾 `-`、空结果报错），并在 `tests/studio-model-routing.mjs` 覆盖 `ark` → `sb-ark`、`ark-plan` → `sb-ark-plan`、`custom-Ab3` → `sb-custom-ab3`、含空格/下划线/中文输入、纯符号输入；验证 `node tests/studio-model-routing.mjs` 该组用例通过
- [x] 1.2 增加 `studioRoutesStatePath(dshHome)` 与自有路由清单读写（`studio-routes.json`，内容 `{ routes: [...] }`，写入用 tmp + rename，读失败或 JSON 损坏按空集处理并记一条可读日志），单测覆盖「文件不存在按空集」「内容损坏按空集且不抛」「写入后能读回」；验证同上
- [x] 1.3 增加纯函数 `planRouteChanges({ owned, next })` 返回 `{ remove, write }`，单测覆盖「新增路由只写不删」「删除路由只删不写」「顺序变化只写不删」「`owned` 为空时只写不删」（首轮同步不得误删宿主或用户自建的 provider）；验证同上

## 2. 按渠道写入宿主路由

- [x] 2.1 `server/app.ts` 增加 `listStudioRoutes()`：按设置页 `providers` 顺序分组，剔除无可用文本模型的渠道与被删渠道下的模型，产出 `{ id, provider, label, models: [{ id, key, label, vision }] }`；`listStudioModels()` 改为从路由结果摊平以保证门面输出不变；验证 `node tests/openai-gateway.mjs` 通过，且同步日志摘要出现渠道数与模型数
- [x] 2.2 `writeStudioProfile` 改为接收 `routes`，按 `planRouteChanges` 删除与写入 provider，每个路由写 `displayName: <渠道 label>`、`apiKeyEnv`/`api`/`baseURL`（门面地址）、模型条目写 `name: <模型 label>` 与视觉模型的 `input: [text, image]`，`providers` 里非自有键原样保留；验证 e2e：两个渠道保存后 patch 出现两个 provider，`displayName` 与设置页一致，模型条目带 `name`，所有 `baseURL` 均为门面地址
- [x] 2.3 归属清理 e2e：手工往 patch 追加一个 `user-owned` provider 后触发同步，验证它仍存在；删除某渠道后该渠道路由消失、其余路由保留；同步把 `tests/studio-model-routing.mjs` 里 `writePatchDefault` / `readPatchDefault` 等 helper 改成路由感知（不再硬编码单一 provider）
- [x] 2.4 兜底路由：可用文本模型为 0 时写入 `sb-app` + `sb/default`（`name: （未配置模型）`），e2e 断言该路由存在、不含本次其它路由，且默认模型指向它
- [x] 2.5 变更检测按「写入内容」比对：原签名（路由 id + displayName + 模型 id=name=vision + 默认配对）漏判「宿主改过默认、路由与回退值未变」的场景，改为每次同步都跑判定、`writeStudioProfile` 仅在序列化内容变化时落盘；e2e 验证「只改渠道 label」「只改模型显示名」都会触发重写，未变化时不重写
- [x] 2.6 在 `docs/creative-host.md` 新增「模型投影：按渠道分路由」小节：配置形态示例、`sb-*` 由应用托管（宿主设置页对该路由的编辑不同步）、`baseURL` 只指向门面、与宿主内置 provider 同名的已知边界；验证文档中的示例 YAML 与实际产出的 patch 结构一致

## 3. 默认模型配对与迁移

- [x] 3.1 把 `decideDefaultModel` 重写为配对语义（入参 `{ existing, lastWritten, fallback, routes }`，输出 `{ write, provider, model, explicit? }`），单测覆盖六态：空、旧 `storyboard`、非自有 provider、与渠道不符、等于上次写入、来源未知但现值有效；`tests/studio-model-routing.mjs` 现有四段用例按配对语义改写
- [x] 3.2 `studio-default.json` 增加 `explicit` 字段：e2e 验证 `explicit: true` 后设置页改「创意（对话助手）」不覆盖宿主选择；`explicit` 为假且现值等于上次写入时跟随设置页更新
- [x] 3.3 `storyboard` 迁移 e2e：预置 `provider: storyboard` 的 `agent-default-model` 后触发同步，验证 provider 改成模型所属渠道路由、模型值不变、`storyboard` 键被删除、`studio-default.json` 记录新配对
- [x] 3.4 来源记录丢失回归：删除 `studio-default.json` 后改设置页默认，验证默认跟随新值（不再永久冻结），且首次丢失时保留现值并落 `explicit: true`（`source: unrecorded`）
- [x] 3.5 渠道错配纠正：默认模型仍有效但 `provider` 与模型所属渠道不符时，同步后配对改到正确路由
- [x] 3.6 `docs/creative-host.md` 补「默认模型与路由迁移」小节：配对判定规则、`explicit` 语义、旧路由一次性退场、历史会话需重选一次模型及其可读报错

## 4. 集成验收

- [x] 4.1 `node tests/studio-model-routing.mjs` 全绿，输出包含分组、显示名、清理、迁移、兜底、显式保留各用例
- [x] 4.2 跑 `npm run test:studio` 确认门面、代理、专家、预热等既有用例无回归
- [x] 4.3 人工验收：宿主「设置 → 模型」显示 N 个渠道卡片（N = 有可用文本模型的渠道数）；模型选择器按渠道分组且条目为应用侧显示名；改创意绑定后宿主默认跟随；删渠道后其分组消失；`/v1/models` 输出与改造前逐项一致

## Workflow follow-up

- 按项目评审要求完成后归档该 change，并确认归档后主 spec 中的场景与实现一致。
