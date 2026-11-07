# Blender 外置技能库（EL4CTEO/blender-skills · 预演只读）

本目录 vendoring 自 [EL4CTEO/blender-skills](https://github.com/EL4CTEO/blender-skills)（MIT）。3D 聊天 agent 在 **full_host** 下可通过 `read_file` / `list_dir` 读取 job 内 **`dcc-skills/`**（与仓库 `skills/scene3d/blender-skills` 同步）。

## 用法

1. `list_dir` → `dcc-skills/` 查看 `blender-*` 子目录。
2. `read_file` → `dcc-skills/blender-core/SKILL.md` 或各专题 `SKILL.md`（按需节选，勿一次读全库）。
3. 落码仍须遵守锁定 ABI（`build` / `pose` / `dispose`）；外库中的绑定、烘焙、游戏导出、Rigify 等 **不得** 写入预演脚本。

## 路由（与 blender-core 对齐）

| 主题 | 目录 |
|------|------|
| 入门与路由 | `blender-core` |
| 场景/单位/集合 | `blender-scene-setup` |
| 硬表面 | `blender-hardsurface-modeling` |
| 雕刻 | `blender-sculpting` |
| 灯光/lookdev/转盘 | `blender-lighting-lookdev` |
| 渲染 Cycles/EEVEE | `blender-rendering` |
| 时段/氛围 | `blender-time-of-day` |
| 天气 | `blender-weather-fx` |
| 动画/运镜思路 | `blender-animation` |
| 风格化 NPR | `blender-stylized-npr` |
| 环境套件 | `blender-environment-kits` |
| 几何节点 | `blender-geometry-nodes` |
| PBR 材质 | `blender-pbr-materials` |
| 贴图/磨损 | `blender-texturing` |
| 全流程菜谱 | `blender-workflow-recipes` |
| 资产 QA | `blender-asset-qa` |

## 预演推荐优先

`blender-core`、`blender-scene-setup`、`blender-lighting-lookdev`、`blender-rendering`、`blender-time-of-day`、`blender-animation`（相机与路径段落）、`blender-environment-kits`、`blender-stylized-npr`。

## 预演默认不展开

`blender-character-rigging`、`blender-export-pipelines`、`blender-game-optimization`、`blender-texture-baking`、`blender-addon-development`、`blender-pipeline-automation`（除非用户明确要求且不影响 ABI）。

预演尺度摘要见 job 内 `dcc-previs-pack.md`。
