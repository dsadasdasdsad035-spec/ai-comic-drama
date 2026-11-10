# 转场食谱索引

`transitionRecipes.json` 提供 Agent 与「智能建议」引用的转场食谱卡片，命名风格对齐 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 的 `references/shots/`，**不包含** Remotion 实现。

## 字段

| 字段 | 必填 | 用途 |
|---|---|---|
| `id` / `category` / `title` / `intent` / `tags` | 是 | 基础索引 |
| `taxonomy` | 建议 | 六类接缝主分类 |
| `modeHint` | 建议 | `effect` / `generated` / `either` |
| `kind` | 否 | `concrete`（默认）或 `technique`（内含多式） |
| `whenToUse` | 建议 | 该用在哪类接缝；Agent 判断适用性 |
| `energy` | 否 | `low` / `mid` / `mid-high` / `high` / `max`；技法卡不设 |
| `durationHint` | 否 | 建议时长（秒） |
| `principle` | 建议 | 视觉机制说明；提示词核心素材 |
| `variants[]` | 技法卡必填 | `{id, label, when, principle}`，每式一类接缝 |
| `pitfalls[]` | 建议 | 已知坑；可转为负向约束 |
| `seedanceHints[]` | 建议 | **完整句子**，可直接进提示词 |

## 从 video-shotcraft 迁移的规则

上游卡结构：frontmatter（`一句话 / 适用 / 时长 / 能量 / 标签`）+ 正文（`## 意图` / `## 动效核心` / `## 参数表` / `## 已知坑` / `## 参考实现`）。

**只迁五处，其余丢弃：**

| 上游位置 | 本地字段 |
|---|---|
| `适用` | `whenToUse` |
| `能量` | `energy`（`n/a 技法卡` → 不设 energy 并标 `kind: technique`） |
| `时长` 的总秒数 | `durationHint`（帧数丢弃） |
| `## 意图` 的核心段 | `principle`（不要截断成口号） |
| `## 已知坑` | `pitfalls[]`（原文摘录，不改写） |

**绝不要迁入：**

- 帧数与帧时间轴（`52f`、`0–34f`、`@30fps`）
- 缓动曲线（`bezier(...)`、`ease-in`、`expo-out`）
- 像素坐标与尺寸（`CX=540`、`2600px`、`160px 叶片`）
- 弹簧参数（`damping 13`、`stiffness 75`）
- CSS 属性与组件名

这些只对 Remotion 渲染有意义，进了提示词会误导模型。

## `seedanceHints` 的写法

必须能直接作为桥接正文的一句。判据：读出来就是「谁/什么在动、怎么动、画面怎么变」。

- 反例：`["推镜穿门"]`（标签）
- 正例：`["摄影机沿门框方向持续推进，穿过门洞进入下一空间"]`

## 技法卡

本身不绑定单一接缝、内含多式选型的卡（如按能量落差选式的镜头交棒三式）用 `kind: technique` + `variants[]`。**不要**压平成单条具体卡——选型语境就在卡内部。

现有三张：`shot-transitions`（交棒三式）、`transition-hidden-cut`（藏切三式）、`transition-travel`（字腔穿越）。

## 校验

```bash
node verify-joins.mjs       # 字段完整性、禁用参数、技法卡结构
node verify-transitions.mjs # 检索覆盖 principle / whenToUse
```
