# Design

## Context

See `proposal.md` - Why. 支撑本次设计的事实（均为在当前代码与运行实例上核对过的结果）：

- 应用侧真相源是 `AppSettings`：`providers[]`（8 个渠道，id 稳定且不可在设置页编辑）与 `models[]`（347 条，`key` 全局唯一，`cap`/`caps` 声明能力）。创意会话只需要其中的文本模型 —— 实测可用文本模型 200 条，分布于 5 个渠道。
- 现投影路径只有一条：`server/app.ts` 的 `listStudioModels()` 产出 `{id: 'sb/<key>', key, label, vision}`，`server/studio-profile.mjs` 的 `writeStudioProfile()` 把它写成**单个** provider `storyboard`，`server/index.mjs` 的 `syncProfile()` 以 `id:vision|default=<id>` 签名判断是否重写，设置保存后经 `onSettingsChanged` 立即调用。
- 宿主侧 `llm-pi-ai` 原生支持多路由，且路由级有 `displayName`、模型级有 `name`（`PiAiModelProfile.name` → `entry.name ?? base?.name ?? id`）；`registrationFacts` 明确把 `displayName` 纳入重注册判定，注释写明「改名必须重注册，否则选择器停在旧标签」。
- 热生效链路完整：`boot/hmr` 的 `watchConfig()` 用 chokidar 监听 patch 文件 → `loader/volatile-update` → `ensureRegistrationFacts()`/`ensureDirectory()` → 注册表 `emit 'llm/adapters-updated'` → 客户端 `service.ts` 监听并 `catalog.refresh()`。因此**本次改动不需要重启宿主，也不需要修改宿主源码**。
- 宿主的模型目录按 provider 分组：`buildModelCatalog` 遍历 `llm.listProviders()`，每组 `name` 取 `provider.name`（即 `displayName`），模型 `name` 取 `model.name`。分组是加字段的自然结果，不是新机制。
- 会话级选择落在 `storages/session_projcache/sessions/*.json` 的 `modelSelection`（`lastUsed` / `pending`）。路由消失后，指向它的历史选择会让该会话撞 `NO_ADAPTER`。

## Goals / Non-Goals

**Goals:**

- 宿主模型选择器按应用渠道分组，分组名与条目名都来自设置页。
- 所有路由仍指向应用自身的兼容门面，账本与截断路径零改动。
- 默认模型是「路由 + 模型」的配对，且永远落在本次同步写入的路由集合内。
- 应用只增删改自己拥有的路由；用户在宿主里另加的 provider 不受影响。
- 纯配置投影变更 —— 不改宿主代码，不改门面契约，模型 id 形如 `sb/<key>` 保持不变。

**Non-Goals:**

- 不解决「单渠道模型过多」（APIMart 186 条）。分组让归属可见，不解决数量；目录模型折叠另立变更。
- 不做历史会话选择的无感迁移（已确认：旧路由直接退场，用户重选一次）。
- 不投影渠道的 `baseURL`/`apiKey`。宿主必须经门面，直连会绕过账本。
- 不投影 `stageMaxTokens.creative` 为模型 `maxTokens`（可在下次单独评估）。
- 不处理与宿主内置官方 provider 的同名冲突（未配 Key 时它不出现在选择器中）。

## Decisions

### D1：渠道 id 直接派生成路由 id，不做命名空间重构

路由 id 规则：`sb-` + `provider.id` 转小写后把非 `[a-z0-9]` 归一为 `-`。当前产出：

```
provider.id     route id       displayName
-----------     ------------   -------------------
ark             sb-ark         字节 · 火山方舟
ark-plan        sb-ark-plan    字节 · Agent Plan
deepseek        sb-deepseek    DeepSeek
minimax         sb-minimax     MiniMax
apimart         sb-apimart     APIMart（APIB）
```

理由：`providers[].id` 由预设写死或形如 `custom-xxxx` 自动生成，设置页不可编辑，因此路由 id 稳定；不需要额外映射表，也不需要把用户可见的渠道名塞进 id。

备选方案与弃用原因：

| 备选 | 弃用原因 |
|---|---|
| 路由 id 用渠道 label 转写 | label 可编辑（用户可改成中文/含空格），改一次就等于改路由 id，历史选择全失效 |
| 路由 id 用 `sb-<序号>` | 删除渠道后序号漂移，归属清理无法判断谁是谁 |
| 保留单一路由，只加模型 `name` | 分组不可见，用户的核心症状未解决 |

### D2：路由归属靠一份自有清单，而非「全部覆盖」

`writeStudioProfile` 的合并策略从「改一个键」升级为「改一个集合」，需要区分「我写的」与「别人的」。清单落在 `$DSH_HOME/studio-routes.json`：

```json
{ "routes": ["sb-ark", "sb-ark-plan", "sb-deepseek", "sb-minimax", "sb-apimart"] }
```

写入算法：

```
owned   = 读 studio-routes.json 的 routes（缺失时为空集）
next    = 本次按设置页渠道顺序算出的路由 id 列表

1) 删除：providers 里键属于 owned 但不在 next 的条目
2) 写入/覆盖：next 里每条路由的 displayName / apiKeyEnv / api / baseURL / models
3) providers 里其余键（不在 owned 也不在 next）原样保留 —— 那是宿主或用户自己的
4) 回写 studio-routes.json = next
```

理由：宿主「设置 → 模型」页允许用户自建 provider，直接按 next 重建整个 `providers` 字典会把它抹掉。既有代码已经为同类原因在 `llm-pi-ai` 段做逐 key 合并，这里把同一条纪律推广到路由集合。

为什么单独一个文件而不是塞进 `studio-default.json`：后者是 `agent-default-model` 的来源记录，格式被测试与宿主语义绑得较紧；混入路由清单会让「默认模型来源判定」与「路由归属判定」互相牵连，一处损坏拖垮另一处。

### D3：默认模型从「模型值」改为「路由 + 模型配对」

现状只校验 `model` 是否仍在模型表里，`provider` 完全不参与判断；且 `studio-default.json` 只在「真的写了」时才生成，文件丢失后没有任何路径能把它补回来 —— 于是现值永久视为「宿主的选择」而冻结（实测：应用已把文本默认改成 `deepseek-chat`，宿主仍停在 `sb/ark-text-lite`）。

新判定（`decideDefaultModel` 的替代）输入 `{ existing, lastWritten, fallback, routes }`，输出 `{ write, provider, model, explicit? }`：

```
1) existing 为空                       -> 写 fallback
2) existing.provider == 'storyboard'   -> 迁移：provider 换成该模型所属渠道的路由，model 不变
3) existing.provider 不是本次路由之一    -> 用户的其它 provider：保留，记 explicit
4) 配对与模型所属渠道不符               -> 重写为该渠道的配对
5) 配对 == 上次我们写的                 -> 跟随 fallback 更新
6) 其余（现值有效但来源未知）           -> 保留并记 explicit
```

`studio-default.json` 扩成：

```json
{ "provider": "sb-deepseek", "model": "sb/deepseek-chat", "explicit": false }
```

`explicit: true` 是新增的关键状态：来源记录缺失 + 现值有效这个歧义只会出现一次，落成显式标记后不再反复。这也是修掉「默认永久冻结」的落点 —— 第 6 条把「未知」变成「已知是用户选的」，而第 5 条让我们的播种值继续可更新。

实施时补了一个必要的区分：同样是 `explicit: true`，「记录文件丢失」与「宿主改过」不能同待遇，否则 `explicit` 一落盘就永久冻住（与「记录丢失后仍要跟随设置页」直接冲突）。因此记录里多一个 `source`：

- `source: host` —— 记录在、值却不同，只能是用户在宿主选择器里改的，永久保留；
- `source: unrecorded` —— 记录丢失（或本次刚从缺失中恢复）先保留现值；下一轮若现值未被改动，则视为旧播种值、跟随设置页默认。

另外：每次同步都会补写这份记录（不再只在真写 patch 时写），并把「未记录但现值等于当前默认」视为应用自己的播种值，于是「记录缺失」导致的冻结最多只持续一轮。

`routes` 提供「模型 key → 路由 id」的归属映射，第 2/4 条靠它推导。

备选方案：把应用默认直接写成 `agent-default-model` 的强一致值（每次同步都覆盖）。弃用原因：会抹掉用户在宿主选择器里的显式选择，违反 `creative-chat` 里「宿主显式选择优先」的解析顺序。

### D4：渠道无可视模型时不出路由；全空时出一条兜底路由

- 某渠道下可用文本模型为 0 → 该渠道不产出路由（`next` 里没有它，旧的被清理）。空分组只会让选择器出现一个点不开的标题。
- 全部渠道都为 0 → 写入兜底路由，保持「绝不回落到宿主内置官方路由」这条既有性质：

```yaml
providers:
  sb-app:
    displayName: 应用模型
    apiKeyEnv: SB_STUDIO_GATEWAY_KEY
    api: openai-completions
    baseURL: http://<host>:<port>/v1
    models:
      - id: sb/default
        name: （未配置模型）
```

门面已把 `sb/default` 转成可读的未配置提示，因此兜底不需要改门面。

### D5：模型条目写 `name`，视觉用 `input` 表达

```yaml
- id: sb/apimart-text-gpt-5-1
  name: GPT-5.1（APIMart）
  input: [text, image]
```

`name` 直接取应用侧的 `label`（回退顺序 `label || model || key`，与现状一致）。不写 `contextWindow`/`maxTokens`：应用侧没有可信的每模型上下文数据，而 `maxTokens` 一旦声明就会成为该模型的每请求默认值，会与应用门面按「创意环节输出上限」动态截断的语义打架。

### D6：变更检测按「写入内容」比对，而非外部签名

原计划的签名是 `(routeId:displayName:[modelId=name:vision,...])...|default=provider/model`，
只把「会改变宿主可见结果」的输入拼进去。实施中发现签名还要覆盖 patch 里的**现值**与
来源记录：宿主改过默认模型、而路由与回退值都没变时，只看路由会漏掉这次重算，
`explicit` 落不下来、默认模型也纠正不了。

改为：`syncProfile` 每次都跑一次投影，`writeStudioProfile` 在落盘前把序列化结果与
文件现有内容逐字比较，相同就跳过 `writeFileSync`。宿主的 `watchConfig` 靠文件改动
触发重载，因此「没变化不写」的效果与原签名方案一致，且不会漏判：

- 显示名/模型名/路由集合/默认配对任一变化 → 内容变化 → 落盘 → 宿主热重载；
- 什么都没变 → 内容相同 → 不写文件，也不触发重载。

代价是每次同步多一次 YAML 解析与序列化（当前 5 条路由 / 200 个模型，毫秒级），
换取判定逻辑在任何输入变化下都不会被跳过。

### D7：迁移一次性完成，旧路由直接退场

第一次同步时按 D2 的 owned 集合处理：`storyboard` 若在 `studio-routes.json` 里（升级场景下该文件尚不存在，因此用一条**隐式归属**规则：`storyboard` 恒视为应用自有）→ 从中删除。同时 D3 第 2 条把 `agent-default-model` 的 provider 改写为渠道路由。

历史会话残留（`session_projcache` 里的 `storyboard/<模型>`）按已确认的选择不处理：该会话的模型按钮退回「选择模型」，用户不重选就发送会撞 `NO_ADAPTER: no adapter registered for provider "storyboard"`，一次点击即可恢复。当前机器实测无此残留（唯一会话为 `lastUsed: null`）。

回滚：保留 `studio-routes.json` 与实际路由，把 `server/studio-profile.mjs` 回退到旧版本即可 —— 旧版本只覆盖 `storyboard` 段，不会删除新路由，但 `agent-default-model` 会被下一次同步改回 `storyboard`；再下一次前向升级又迁移回来。升级前把 `dsh/profiles/web/cordis.patch.yml` 备份一份（`readProfilePatch` 已有 `.bak-<ts>` 机制）即可完整回退。

## Risks / Trade-offs

| 风险 | 说明 | 处置 |
|---|---|---|
| 旧会话 `storyboard` 选择撞 `NO_ADAPTER` | 路由删掉，历史选择悬空 | 已确认接受；会话选择器退回「选择模型」，一次点击恢复 |
| 宿主「设置 → 模型」页可删我们的路由 | 用户删掉后下一次同步又写回来，像"删不掉" | 文档写明 `sb-*` 由应用托管、对该路由的编辑不同步；不隐藏、不阻断 |
| 与内置 `deepseek-official` 同名 | 应用「DeepSeek」渠道与内建 provider 都叫 DeepSeek | 内建 provider 未配 Key 时不出分组，当前不可见；文档记为已知边界，不做重命名 |
| 写入半途失败导致 patch 不可用 | 宿主的 `assertServiceable` 会拒绝并保留旧路由，症状是"改了没生效" | 写盘前逐条自检（非空 id、`input` 非空数组、路由 id 唯一）；失败时**不写**文件并记可读日志，保留上一份 |
| 单渠道 186 个模型仍很长 | 分组只解决归属 | 明确 Non-Goal；搜索框可用，数量问题另立变更 |
| 应用与宿主并发写同一 patch | 现状已存在（读-改-写无锁），本次不新增竞态类型 | 沿用现有策略；路由集合扩大后写窗口略长，但仍是一次 `writeFileSync` |
| 路由 id 与模型 key 的归属表重复计算 | `listStudioRoutes()` 与 `listStudioModels()` 各扫一遍 347 条 | 单次扫描内构建 `key → routeId` 映射，两处共用；模型量级下开销可忽略 |

## Migration Plan

1. 先落投影与写入（D1/D2/D5/D6），此时路由表已正确，`agent-default-model` 仍可能悬空 —— 但 D3 第 4 条会把它纠正为渠道配对，因此在同一提交内完成 D3。
2. 部署后首次同步自动完成迁移：`storyboard` 退场、默认模型换配对、`studio-routes.json` 落盘。
3. 验证清单：宿主「设置 → 模型」显示 N 个渠道卡片（N = 有可用文本模型的渠道数）；模型选择器按渠道分组且条目为中文名；设置页改「创意（对话助手）」后宿主默认跟随；删除某渠道后其分组消失。
4. 回滚见 D7。

## Open Questions

无。两个影响方案走向的决策（旧会话迁移策略、分组显示名是否加来源后缀）已在探索阶段确定：旧路由直接退场、分组名用设置页原始 label。
