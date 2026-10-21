# Style Guide — Cinema Dark（OLED 影院暗 × IDE 高对比）

> 依据 ui-ux-pro-max 技能库选定：风格基座 `Dark Mode (OLED)`（WCAG AAA、性能优），
> 配色锚点 `Developer Tool / IDE`（深底 + 冷蓝 focus + 高对比文字），
> 字体规范 `Dashboard Data`（数据/时间码用等宽，标签用无衬线）。

## 选型理由

本产品是**长时间盯看的暗色创作工具**（画布 + 时间线 + 表格），对标剪辑软件/IDE 而非营销页：

| 候选风格 | 结论 |
|---|---|
| Dark Mode (OLED) | ✅ 近黑底省电护眼、对比 AAA、性能优秀 |
| Soft UI Evolution（技能默认推荐） | ❌ 浅色 SaaS 向，与本工具气质不符 |
| Parallax Storytelling | ❌ 重动效、可访问性差，营销页专用 |

## Token 规范（`src/theme.css :root`）

### 表面 4 级
| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#070b11` | 画布底 |
| `--bg-2` | `#0c131c` | 次级底 |
| `--panel` | `#0e1620` | 面板 |
| `--panel-2` | `#111c28` | 面板强调/顶栏渐变起点 |

### 描边 2 级
`--line: #1d2b3a`（静态）/ `--line-2: #2a3d52`（hover/active）

### 文字 3 级（对 `--panel` 对比度均 ≥ AA）
| Token | 值 | 对比度 | 用途 |
|---|---|---|---|
| `--text` | `#dbe7f3` | 14.5:1 | 主文字 |
| `--text-2` | `#b6c8da` | 10.6:1 | 次级文字 |
| `--muted` | `#7d93ab` | 5.7:1 | 辅助说明（下限就是它，不许更暗） |

### 主色与语义色（每类只许一个）
`--accent: #38bdf8`（选中/聚焦/播放）· `--warn: #fbbf24` · `--danger: #f87171` · `--ok: #4ade80`
dim 底色用对应 `rgba(x, 0.12)`。

### 字体
- `--font-sans`：系统栈（`-apple-system, PingFang SC, …`）——本地工具不依赖外网字体
- `--font-mono`：`SF Mono / JetBrains Mono / Fira Code`——**时长、镜号、时间码、集号一律 mono + tabular-nums**

### 动效与焦点
- 时长三档：`--dur-fast/base/slow = 150/200/300ms`，缓动 `--ease`
- 键盘焦点：`--focus-ring: 0 0 0 2px rgba(56,189,248,.55)`

## ⚠️ 历史事故（不许再犯）

2026-10-21 审查发现：9 个 token 曾被写成自引用（`--muted: var(--muted);`），
浏览器判定 invalid → 属性退回初始值。后果：**全站字体退化成 Times（衬线体）**、
次要文字与主文字同色、warn/danger/ok 语义色全部失效，231 处声明受影响。

**规则：token 定义必须写字面值，禁止 `--x: var(--x)`。**
补丁脚本批量替换 CSS 后必须跑 `node verify-style.mjs` 复验。

## 审查基线（Playwright 实测）

`node verify-style.mjs` 输出：token 全部解析、body 字体 sans、muted ≠ text、
全部前景色对比度 ≥ 5.7:1。改动样式后跑一遍即回归。

## 已达标项（无需再动）

- focus-visible 4 处、prefers-reduced-motion 2 处、cursor:pointer 33 处
- 硬编码 hex 仅剩 16 处（主要是角色节点新增样式，已符合色板）
- z-index 已成规模（30/40/60/80）
