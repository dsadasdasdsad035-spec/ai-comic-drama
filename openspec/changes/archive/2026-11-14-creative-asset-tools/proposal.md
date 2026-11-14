# Proposal

## Why

创意会话的 Pi agent 无法盘点项目里到底有哪些物料。现有平台读工具只覆盖原著、分集、角色、场景/道具设定卡、分镜与内置运镜库；`project.assets`（素材卡，含视频/音频/表情总图）和 `project.lexiconWhitebox`（项目级自定义白模）完全没有读工具。结果是模型只能靠用户口述或猜测的 id 去引用素材，写出的提示词与项目实际拥有的镜头语言脱节。

## What Changes

- 新增平台内置只读工具 `read_asset_inventory`：项目物料地图。默认只返回各分类计数；`includeRows: true` 时返回该分类的轻量行（含可直接回传的 `key`）。
- 新增平台内置只读工具 `read_asset_detail`：按 `category + key` 取单条完整记录。白模默认不返回 `sceneCode.code`，需显式 `includeCode: true`。
- 两个工具覆盖五个分类：`characters`、`scenes`、`props`、`assets`、`whitebox`。
- 保留既有细粒度工具（`read_characters` / `read_designs` / `list_camera_lexicon`）不变，二者分工：新增工具负责"发现与钻取"，既有工具负责"按名字批量过滤"。
- 创意 Pi 的 system 增加一句：不确定项目里有何物料时先调用 `read_asset_inventory`。
- 专家白名单与技能可声明工具集同步纳入两个新工具。

**非目标（不在此变更内）**

- 不改 `read_shots` 的 8KB 截断策略。镜头（`shots`）不属于本次"素材"范围。
- 不接 `/api/media` 的磁盘媒体目录；`assets` 只读 `project.assets`。
- 不新增视觉能力（看图/看视频）。素材卡只返回路径与元数据，agent 仍看不到画面。

## Capabilities

### New Capabilities
- `creative-asset-tools`: 创意 Pi agent 读取项目物料的聚合读工具——物料地图、按需钻取、白模代码按需加载与截断。

### Modified Capabilities
<!-- 无：既有 creative-chat / project-context / chat-agent-runtime 的需求均不变。 -->

## Impact

- `src/agent/stageTools.ts`：新增两个 `defineTool` 并注册进 `readByName`。
- `src/agent/builtinPlatformTools.ts`：`builtinPlatformToolNames()` 增加两个名字（专家设置页与检查器据此展示）。
- `src/skills/tools.ts`：`KNOWN_TOOL_IDS` 增加两个名字，`read_` 前缀自动归入只读集。
- `src/creative/expertToolGroups.ts`：`READ` 分组与 `DEFAULT_EXPERT_PLATFORM_TOOLS`。
- `src/creative/creativeTurnPayload.ts`：`CREATIVE_PLATFORM_LINES` 增加调用提示。
- `experts/expert-omni/manifest.json`：`toolIds` 增加两个名字。
- `src/agent/stageToolUis.tsx`：工具卡片中文标签。
- `verify-creative-builtin-tools.mjs`：补齐验收参数，否则该脚本会把新工具判为"未配置验收参数"。
