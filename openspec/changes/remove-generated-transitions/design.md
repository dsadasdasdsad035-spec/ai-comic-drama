# Design

## Context

问题与范围见 `proposal.md`。这里只记录动手前必须定下的技术选择。

现状里有三件事决定了做法：

1. **接缝数据只有一个落点**：`transition_out` 挂在源镜头上，以目标镜稳定键 `to` 指向下一镜。生成配置（`generated`）与效果配置（`effect`）是这个对象里的两个并列字段，所以「删生成」可以只删字段、不动外层结构与寻找逻辑。
2. **成片时间由 `buildEditList` 统一给出**：效果转场走 A + B − T 重叠，生成转场走「插入片段 A + T + B − 2f」。删掉插入分支后，折叠循环退化成单一分支，但起点计算、`inactive` 判定、字幕基准与导出用的 `joins[]` 都不需要改。
3. **中点标签在 2026-11-13 被刻意删除**（commit `82c7178`），理由是胶囊内容在「关系名」与「接缝摘要」之间切换。删除生成后内容收敛为唯一一种，该理由失效；但当时的技术约束仍然成立——缩放补偿必须隔离在独立子组件，否则缩放时每条边整帧重渲染。

## Goals / Non-Goals

**Goals**

- 让「转场」成为一个只读一种数据、只走一条渲染路径的概念。
- 让画布上每条转场连线自己说明自己是什么缝，不需要先点开。
- 旧项目零迁移成本打开：有 `effect` 就按 `effect` 渲染，`generated` 直接当不存在。

**Non-Goals**

- 不重构效果转场的夹紧规则、预设目录与 xfade 映射。
- 不重构统一剪辑序列的折叠算法（只删一个分支）。
- 不为「两镜之间想要一段生成画面」提供替代方案。
- 不清理 `project.json` 里已经写下的 `generated` 历史字段（不写迁移脚本、不批量改写存档）。

## Decisions

### D1 · 保留 `mode` 字段但收敛为单值，不删字段

`TransitionOut.mode` 曾经是 `'effect' | 'generated'` 的二选一。删除生成后有两个选择：把 `mode` 整个删掉，或保留字段但只允许 `'effect'`。

选**保留字段**。理由：`normalizeTransitionOut` 是读旧存档的唯一入口，`mode` 是判断「这条旧线到底怎么渲染」的现成信号。保留它让旧数据在读取时仍能识别形状，写回时统一输出 `'effect'`，一处收敛；如果删掉字段，`normalize` 就得靠「有没有 `generated`」反推意图，反而更脆。

代价是一个语义单值的字段长期存在。接受——它是稳定键 `to` 旁边的显式判别位，删掉后读者还要自己推断。

### D2 · `generated` 读时忽略、写时剥离，不做数据迁移

三个选项：

- **读时忽略**：`normalizeTransitionOut` 不再输出 `generated`，`resolveJoin` 不再看它。
- **读时清空**：读入后立刻把字段置空并触发一次写回。
- **写迁移脚本**：遍历所有项目批量删除。

选**读时忽略**。生成配置里没有任何需要抢救的信息——产物视频、参考、提示词全部失效；而「读时清空 + 自动写回」会在用户只是打开一个旧项目时就产生写操作，违反「不要因为看一眼就改存档」的既有约定（旧存档兜底叠化就是这么定的）。

写回时机由用户动作自然触发：任何一次 `patch` 该镜头都会经过 `normalizeTransitionOut`，`generated` 就此消失。这不保证清理彻底，但清理不是目标。

**副作用**：`transition_out.generated.video.url` 指向的媒体文件会变成孤儿。不主动删——`scripts/cleanup-orphan-media.mjs` 已经是这件事的既有出口。

### D3 · `resolveJoin` 删除生成分支，而不是保留一条不可达分支

`resolveJoin` 现在的形状是「有 url 就插入片段 → 没出片就回落效果 → 否则纯效果」。删掉生成后，前两段都消失，只剩效果。

选择**直接删掉整段**，不保留 `mode === 'generated'` 的判空分支。理由：保留不可达分支会让下一个读者反复确认「这条路径是不是还能进」。`normalizeTransitionOut` 已经把 `mode` 收敛成 `'effect'`，`resolveJoin` 收到的输入里不可能再有 `generated`，分支就是死代码。

### D4 · 时间线与预览删除「转场块」，不保留占位

生成转场在时间线上是一个独立片段（`.ntl-clip.transition`），在预览播放列表里是一个 `kind: 'transition'` 的条目。效果转场从来不占独立块——它表现为两个镜头块的**重叠**与一个 xfade 标记（`.ntl-xfade`）。

因此删除生成后，`EditItem.kind` 收敛为只剩 `'shot'`，`EditList.transitions` 计数、`edit.stale`、`Preview` 的转场条目与 `staleTransitions` 上报全部消失。保留 `kind` 字段但永不产生 `'transition'` 是错的——`EditItem` 没有对外兼容约束，直接收窄类型更诚实。

### D5 · 连线标签用 `EdgeLabelRenderer` + 独立缩放订阅组件

沿用 `82c7178` 之前的结构，但内容恒定：

```
ShotEdge (memo, 不订阅 transform)
  +-- BaseEdge                     只画线，零额外重渲染
  +-- EdgeChip (独立组件)
        useStore(st => st.transform[2])   只有它订阅缩放
        EdgeLabelRenderer
          <span style="translate(-50%,-50%) translate(x,y) scale(1/zoom)">
            叠化 0.5s
          </span>
```

标签数据来自 `ShotEdgeDataType` 上一个新字段（例如 `seamLabel?: string`），由 `App.tsx` 在装饰边时用现成的 `transitionSummary()` 填好。这样 `ShotEdge` 保持纯展示、不 import 转场逻辑，也就不会因为引入 `transition.ts` 而把预设目录拖进每条边的依赖图。

只有 `relation === 'transition'` 时才渲染 `EdgeChip`；其它关系直接返回单条 `BaseEdge`。

**pointer-events**：标签必须 `pointer-events: none`（或让点击穿透到线身），否则它会吃掉点击并挡住菜单入口。这是本次新增的明确约束。

**替代方案**：把标签塞进右键菜单头部（现状就是这样）。否决——用户明确要求「只需要展示连线是什么转场类型就可以了」，展示必须在线上。

### D6 · 「转场面板」收缩为「接缝设置」，保留文件不新建

`TransitionPanel.tsx` 现在 873 行，其中生成段约占 550。收缩后剩约 200 行：预设网格、时长输入、成片 delta 摘要、未参与成片警告。

选择**原地收缩**而不是「删掉重写一个新文件」。理由：组件契约（`edge` / `source` / `target` / `onPatch` / `onSetRelation`）与打开/关闭逻辑（`selEdgeId` 互斥）都还能用，重写只会重复一遍已经稳定的部分，还会让 `App.tsx:4966` 的挂载块大改。

命名上从「转场」改为「接缝设置」：`TransitionPanel.tsx` → 保留文件名（避免无意义的重命名 diff），但面板标题、菜单项文案、`aria` 标签改为「接缝设置」。文件名与标题不一致是可接受的，因为文件名描述的是数据域（transition），标题描述的是用户动作（接缝设置）。

### D7 · 服务端只删转场模式，保留 `assemble` 的 `kind` 兼容

两处独立的服务端逻辑：

- `/api/seedance` 的 `transition` 入参 → `transitionMode` → 首尾帧/morph/keyframe 降级链。**整段删除**，同时删掉 `src/api.ts` 里 `StartVideoOptions.transition` 的声明。删掉后 `/api/seedance` 仍支持首帧、参考图、参考视频、原生音频、纯文本——这些是分镜出片在用的。
- `/api/assemble` 的 `ExportSegment.kind` 判分支 → 只影响请求体里的字符串标识。**保留读取**（旧请求/旧脚本可能仍带 `'transition'`），但前端不再产生该值。删掉它的收益为零，风险是某个回归脚本或外部调用方 400。

### D8 · Agent 工具删除而非降级

`attach_transition_refs` / `set_transition_audio` / `read_transition_video_inputs` / `read_transition_recipes` 四个工具的全部业务语义都是生成转场。选择**直接删工具**，不做「调用即返回错误」的兼容层——Agent 的可用工具清单是每次请求下发的，删掉后模型根本看不到它们，不会去调用。

`submit_joins` 保留，但 schema 里 `mode` 的枚举收敛为 `'effect'`，`generated` 子对象与 `taxonomy` / `recipe_ids` 删除。旧 Agent 提示词若仍写 `mode: generated`，`zod` 会拒绝并回一条明确的校验错误——这是可接受的失败形态，因为技能包会随本次一并更新。

`shotJoins.applyJoinsToShots` 的 `generated` 分支同步删除；`JoinApplyResult.generated` 计数移除。

### D9 · 回归脚本按「保留 / 重写 / 退役 / 不动」四类处理

| 脚本 | 处理 |
|---|---|
| `verify-transitions.mjs` | 保留：夹紧、折叠时间账、非相邻、持久化映射、模型时长分流里仍有效的那部分；删除生成插入、指纹失效、生成回落的用例 |
| `verify-transitions-ui.mjs` | 重写：生成段（约 20 条断言）删掉，新增连线标签断言 |
| `verify-edge-menu.mjs` | 修改：`'画布上没有任何连线标签'` 反转为「转场线有标签、其他关系无标签」 |
| `verify-transition-folds.mjs` | 退役：它验的是生成模式的折叠结构（出片设置收起、提示词展开），接缝设置不需要 |
| `verify-boundary-frames.mjs` | 不动：验的是通用抽帧接口 |
| `verify-native-audio.mjs` | 不动：验的是纯函数能力门，与转场无关 |
| `verify-joins.mjs` | 收窄：去掉 generated 相关断言 |

## Risks / Trade-offs

- **旧项目的生成转场产物变成孤儿文件** → 不主动清理；`scripts/cleanup-orphan-media.mjs` 是既有出口。若用户反馈磁盘占用，再单独做一次盘点。
- **正在运行的转场任务在升级后无法取消** → 产物不会被写回任何位置，任务只是空跑完。接受：生成转场本身是逐条手动触发的低频操作。
- **`transitionSuggest` 与 `/api/transition/suggest` 在删除前已无前端调用方** → 删除风险为零；但要确认没有外部脚本依赖，故在任务里留一条 grep 校验。
- **标签被误当成可点元素** → `pointer-events: none` + 回归脚本里断言「点标签等价于点线身」。这是本次唯一新增的交互风险点。
- **文件名 `TransitionPanel.tsx` 与标题「接缝设置」不一致** → 接受，见 D6；在文件头注释里写清保留文件名的理由。
- **`mode` 字段收敛成单值后仍留在类型里** → 接受，见 D1；`normalizeTransitionOut` 的 JSDoc 要写明「为兼容旧存档保留，写入恒为 effect」。

## Migration Plan

1. 不改数据库结构、不写迁移脚本。
2. 部署顺序无要求：前端不再读 `generated`，服务端删掉 `transition` 入参，两者互不依赖。
3. 回滚：恢复代码即回滚；旧数据里的 `generated` 若未被写回覆盖仍在，可继续使用。已写回的镜头失去生成配置，不可恢复——这是单向操作，但用户已明确接受（本地无存量生成转场）。
4. 未归档变更处置：`transition-video-inputs`（21/22）、`transition-ref-agent-write`（15/16）、`shot-table-transition-joins`（15/17）三条随本次关闭或标记废弃；`transition-joins`（30/30）的效果部分由本变更的 `shot-transition-seams` 接管，归档时以本变更为准。

## Open Questions

无。所有影响规格、做法或任务拆分的选择已在上文定案。
