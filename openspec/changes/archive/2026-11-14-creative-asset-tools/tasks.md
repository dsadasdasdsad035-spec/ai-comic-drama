# Tasks

## 1. 物料读取核心

- [x] 1.1 在 `src/agent/stageTools.ts` 增加 `read_asset_inventory` 工具：按 `category` 回计数（`characters`/`scenes`/`props`/`assets`/`whitebox` + `cameraLexicon`），`assets` 计数按 `kind` 细分；未选项目返回 `ok:false` 可读错误。验证：`npm run build` 通过，且工具在 `readByName` 中可取到
- [x] 1.2 为 `read_asset_inventory` 增加行模式：`category` + `includeRows:true` 返回带 `category`/`key`/标题的轻量行，支持 `kind`/`q`/`limit`（默认 50，上限 200），截断时回 `truncated` 与总数，且行内不含代码正文与 data 地址。验证：对含视频素材卡的项目调用，返回行 `key` 等于素材 `url`
- [x] 1.3 增加 `read_asset_detail` 工具：按 `category` + `key` 返回单条完整记录，素材卡以 `url` 为 `key`；key 不存在返回 `ok:false`。验证：用 inventory 返回的 key 取回同一角色
- [x] 1.4 为 `read_asset_detail` 增加白模代码策略：默认省略 `sceneCode.code`、只回 `codeHash`/`codeChars`/`hasVideo`；`includeCode:true` 时返回代码，超 20000 字符截断并回 `truncated` 与原始 `chars`。验证：同一条白模两次调用，默认响应不含代码、显式请求含代码
- [x] 1.5 把两个工具注册进 `createStageToolSet` 的 `readByName`，并保持 `read_characters`/`read_designs`/`list_camera_lexicon`/`get_camera_lexicon` 行为不变。验证：`npm run build` 通过，既有工具签名与返回形状未改

## 2. 工具清单与专家白名单

- [x] 2.1 在 `src/agent/builtinPlatformTools.ts` 的 `builtinPlatformToolNames()` 增加两个工具名。验证：`node -e` 或单测打印该函数结果包含两个名字
- [x] 2.2 在 `src/skills/tools.ts` 的 `KNOWN_TOOL_IDS` 增加两个名字，确认 `READ_TOOL_IDS` 自动归入只读集。验证：打印 `READ_TOOL_IDS` 含两个名字
- [x] 2.3 在 `src/creative/expertToolGroups.ts` 的 `READ` 集与 `DEFAULT_EXPERT_PLATFORM_TOOLS` 增加两个工具名。验证：`groupExpertPlatformTools` 把两者归到 `read` 分组
- [x] 2.4 在 `experts/expert-omni/manifest.json` 的 `toolIds` 增加两个工具名。验证：文件为合法 JSON 且含两个名字
- [x] 2.5 在 `src/agent/stageToolUis.tsx` 的 `LABELS` 增加两个中文标签。验证：`npm run build` 通过

## 3. 创意会话提示

- [x] 3.1 在 `src/creative/creativeTurnPayload.ts` 的 `CREATIVE_PLATFORM_LINES` 增加「不确定项目里有何物料时先 `read_asset_inventory`，再按 key 调 `read_asset_detail`」的指引，确保自主模式与专家模式都带该提示。验证：调用 `buildCreativePiSystemAutonomous()` 与专家 system 构造，输出均含该指引

## 4. 验收脚本与构建

- [x] 4.1 在 `verify-creative-builtin-tools.mjs` 的 `staticArgs` 补 `read_asset_inventory` 与 `read_asset_detail` 的最小参数（detail 的 key 从 inventory 行动态取），避免判为「未配置验收参数」。验证：脚本对两个工具输出 ✅
- [x] 4.2 运行 `npm run build` 全量通过。验证：命令退出码 0
- [x] 4.3 运行 `node verify-creative-builtin-tools.mjs` 全部工具 invoke 无 throw。验证：脚本退出码 0

## Workflow follow-up

- 归档前用 `openspec validate creative-asset-tools --strict` 复核规格。
- 归档后由 `/opsx-archive` 处理。
