# Proposal

## Why

项目是全站唯一数据边界，但生命周期只有「建」这一半：新建入口藏在镜头表的视图工具条里，内容列一变窄（≤1100px）整块被 `display:none`，开着聊天面板就找不到；删除则完全没有——`/api/project` 只接受 GET/POST/PUT，`server/db.mjs` 只有 `createProject` / `readProject` / `writeProject`，界面上唯一叫「清空」的动作只清浏览器画布。结果是本地库积累了 433 个项目，其中 154 个是 `verify-*` 测试残留，只能停服务、手写 SQL 级联十二张表，还要记得清 `localStorage` 画布 key，否则同名重建会把旧画布捞回来。

## What Changes

- 新建项目移到全局带：项目选择器旁提供一个常驻的创建入口，不再受视图工具条的窄宽度折叠影响；镜头表工具条里的重复入口移除。
- 新增服务端项目删除能力：`DELETE /api/project`，按项目名级联清理所有项目域表（镜头、角色、素材、设定、集、场次、场景布局、在线素材留档、聊天线程、成片、发布任务/意图/事件），并移除项目独占的媒体目录。
- 删除前强制落一份可手工恢复的 JSON 快照（含主表与全部子表行），快照写失败则中止删除；快照不提供自动恢复入口。
- 删除前提供预览：各表行数、媒体目录体积、成片与发布记录数量；存在活动发布任务时拒绝删除并列出任务。
- 设置页「数据」升级为「项目与数据」：项目清单（名称、标题、集/镜数、更新时间）、搜索、单项删除与多选批量删除；单项要求输入项目名确认，批量要求输入选中数量确认。
- 删除当前项目后，全局上下文安全回退到剩余项目或「未选项目」，并清理该项目的浏览器画布状态；不产生跨项目写入。
- 明确不删除：`public/exports/`、`public/publish-packages/`、`public/generated/` 等共享产物池（扁平命名、可能与已发布内容关联，另行治理）。已发布到平台的内容不受本地删除影响，也不能撤回。

## Capabilities

### New Capabilities

- `project-lifecycle`: 项目的新建入口与命名约束、删除预览、删除确认强度、级联范围、删除前快照、活动发布任务保护、独占文件清理、批量删除与删除后的全局上下文回退。

### Modified Capabilities

- `project-context`: 新增「删除当前项目后的上下文回退」要求：项目被删除后全站上下文必须切换到剩余项目或未选状态，且不得把被删项目的数据带进新上下文。
- `workbench-shell`: 全局带承载项目生命周期动作——新建入口必须常驻全局带并在窄宽度下仍可用；项目创建与删除 MUST NOT 藏在某个视图的上下文带里。

## Impact

- 服务端：`server/db.mjs` 新增 `deleteProject`、`previewProjectDelete`、`snapshotProject` 与级联删除清单；`vite.config.ts` 的 `/api/project` 路由新增 `DELETE`（单项目 `?name=`，批量 `?names=`）与删除预览分支；删除时联动 `server/publish-jobs.mjs` 的活动状态判断。
- 前端：新增项目创建对话框（`src/ProjectSelect.tsx` 或独立 `src/project/` 模块）；`src/App.tsx` 负责删除后重置 `projectName` / `readyProject` / `epNo` / 画布状态与 `localStorage['storyboard-canvas-v1:<项目>']`；`src/settings/SettingsPage.tsx` 的「数据」分区改为项目管理面板；`src/api.ts` 增加删除与预览调用；`src/ShotTable.tsx` 移除重复的新建入口。
- 数据：无新表；删除按 `project_id` 与项目名两类关联键覆盖 12 张表，顺带清理 `publish_events`（按 job id）。新增 `projects/.deleted/` 快照目录，加入 `.gitignore`。
- 风险：删除不可逆（除快照手工恢复）；活动发布任务期间删除会破坏队列，必须以 409 拒绝；共享产物池不在清理范围，删除后仍会留下成片文件。
- 验收：新增 `verify-project-lifecycle.mjs`（临时 `SB_PROJECTS_DIR`），覆盖预览计数、快照、级联、活动任务拦截、批量部分失败、同名重建后画布不复活。
