# Design

## Context

参见 `proposal.md`。当前实现约束：

- 单进程应用：前端由 Vite 提供，API 路由集中在 `vite.config.ts` 的 middleware；数据存 `<SB_PROJECTS_DIR>/storyboard.sqlite`（默认 `projects/storyboard.sqlite`），项目媒体存 `<projects>/<项目>/assets/`。
- `server/db.mjs` 持有进程级单例连接 `open(root)`，项目读写都走它；`deliverables` / `publish-jobs` / `publish-intents` / `publish-accounts` 各自用 `openDatabase(root)` 独立连接，并都从 `db.mjs` 导入 —— 因此删除逻辑不能放进 `db.mjs` 再反向引用这些模块，否则形成循环依赖。
- 12 张表与项目关联，分两类键：`project_id`（外键）与项目名字符串（`project` 列）。数据库本身没有 `FOREIGN KEY` 声明，删除不会级联。
- `writeProject` 对不存在的项目会隐式建骨架；`createProject` 已存在则报错不覆盖。
- 画布状态按项目存在 `localStorage['storyboard-canvas-v1:<encodeURIComponent(项目名)>']`，由 `App.tsx` 在 400ms 防抖后写入；清空该 key 前必须先让 `readyProject` 与 `projectName` 脱钩，否则下一次防抖会把旧画布写回。
- 新建入口目前是 `ShotTable` 工具条里的 `wb-bar-optional`，`WorkbenchBar` 在内容列 ≤1100px 时把整个 `wb-bar-optional` 隐藏。
- 共享产物池 `public/exports/`、`public/publish-packages/`、`public/generated/`、`public/videos/`、`public/voices/` 是扁平命名，不按项目分目录。

## Goals / Non-Goals

**Goals:**

- 删除是单一服务端入口：预览、快照、活动任务保护、级联、文件清理都在一处完成，前端不做数据拼装。
- 快照可以在没有自动恢复 UI 的前提下手工重建项目。
- 全局上下文在删除后回到一致状态，不会向已删除项目写入。
- 项目生命周期入口在全局带，不随视图宽度消失。

**Non-Goals:**

- 自动恢复/撤销删除（快照只供手工恢复）。
- 清理共享产物池里的成片、发布包、生成图与配音。
- 软删除、回收站、项目归档/只读。
- 项目重命名与复制。
- 删除平台账号、发布浏览器 profile 或创意会话（三者都不属于单个项目）。

## Decisions

### D1 删除逻辑放进独立模块 `server/project-lifecycle.mjs`

```js
// 依赖方向：project-lifecycle.mjs -> db.mjs, publish-jobs.mjs
export function previewProjectDelete(root, name) // 只读：各表计数、媒体体积、活动任务
export function deleteProjects(root, names, opts) // 逐项 deleteOne，返回逐项结果
```

`deleteOne` 用 `openDatabase(root)` 的独立连接，`BEGIN IMMEDIATE` 事务；不碰 `db.mjs` 单例，避免和 `publish-jobs.mjs` 形成循环导入。`vite.config.ts` 只做参数校验与路由。

替代方案：直接在 `db.mjs` 写 `deleteProject`。被否，原因是拿不到 `ACTIVE_STATES` 又不想复制状态常量；复制会让状态机两处维护。

### D2 级联清单集中成一张表，按依赖顺序删除

```js
const PROJECT_CASCADE = [
  ['shots',         'project_id'],
  ['characters',    'project_id'],
  ['assets',        'project_id'],
  ['designs',       'project_id'],
  ['scenes',        'project_id'],
  ['episodes',      'project_id'],
  ['scene_layouts', 'project_id'],
  ['stock_imports', 'project_id'],
  ['chat_threads',  'project'],      // 项目名字符串
  ['publish_events', 'job_id IN (SELECT id FROM publish_jobs WHERE project = ?)'],
  ['publish_jobs',  'project'],
  ['publish_intents', 'project'],
  ['deliverables',  'project'],
]
// 最后 DELETE FROM projects WHERE name = ?
```

清单用 `{table, where, params}` 结构，删表顺序固定；`publish_events` 必须先于 `publish_jobs`。新增项目域表时只改这张清单，并在验收里断言「无孤儿行」。

### D3 快照先落盘，再在事务里删

- 快照路径：`<projects>/.deleted/<项目名>-<ISO 时间戳>.json`，加入 `.gitignore`。
- 结构：`{ version: 1, project: <projects 行>, tables: { [table]: rows[] }, deletedAt, roots: { projectsRoot } }`；`tables` 覆盖清单里全部表（按项目筛选后的行）。
- 写入方式：同目录 `.tmp-<pid>-<ts>` 后 `renameSync`；任何异常都 `throw`，事务 `ROLLBACK`，接口返回 500 且项目数据不变。
- 快照不含媒体文件；响应与设置页文案必须说明「媒体文件不随快照恢复」。

替代方案：删除前把整个项目目录改名备份。被否，原因是媒体可能是几百 MB，删除语义是腾空间，不是搬运；数据库行才是难重建的部分。

### D4 删除顺序：DB 事务提交成功后再删文件

1. 写快照。
2. `BEGIN IMMEDIATE`；按 D2 删除；`DELETE FROM projects`。
3. `COMMIT`。
4. `fs.rmSync(<projects>/<项目名>, { recursive: true, force: true })` 与 `<appRoot>/.scene-drafts/<项目名>`；失败不抛，记 `warnings` 返回。

理由：文件系统不可回滚。先删文件、事务失败就丢数据；先提交再删文件，最坏结果是「记录已删、目录残留」，可重试且不影响数据一致性。结果里用 `filesRemoved` 与 `warnings` 表达真实状态，不假装成功。

**共享产物不删**：`public/exports`、`public/publish-packages` 等一律不动；接口响应固定带 `sharedFilesKept: true` 与说明文案。

### D5 活动发布任务用 409 拒绝，批量逐项继续

- 活动状态取 `server/publish-jobs.mjs` 的 `ACTIVE_STATES`（`draft/queued/uploading/awaiting_user/awaiting_confirmation/submitted`）。
- 单项删除命中活动任务时抛结构化错误 `{ code: 'active_jobs', jobs: [{id, platform, state}] }`，HTTP 409。
- 批量接口对每个名字独立执行，逐项返回 `{ name, ok, code?, message?, warnings? }`；一项失败不中断，也不回滚已完成项。

替代方案：先取消任务再删除。被否，原因是取消会改变已排队的发布语义，且需要人工确认；用户该先处理任务。

### D6 API 形状

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| `GET` | `/api/project?name=<项目>&preview=delete` | 删除预览：`counts`、`mediaBytes`、`activeJobs`、`exists` |
| `POST` | `/api/project?preview=delete` + `{names:[...]}` | 批量预览：逐项 `items`，一次算完 |
| `DELETE` | `/api/project?name=<项目>` | 删除单个；成功 `{ ok, deleted: name, filesRemoved, sharedFilesKept, warnings }` |
| `DELETE` | `/api/project` + `{names:[...]}` | 批量删除；`{ ok: true, results: [...] }`，HTTP 200，即使部分失败 |
| `DELETE` | `/api/project?names=a,b,c` | 同上，兼容查询串写法（名字多时受 URL 长度限制） |

名字逐个过 `safeProjectName`，非法即 400。

> 后续调整：最初的批量上限 50 已移除。清理几百个测试项目时上限只是把「一次点完」变成「分四次点」，还让查询串更容易超长。现在批量走请求体，服务端仍逐项独立快照与事务；预览同步改为一次请求算完，避免前端为每个选中项各发一次。

替代方案：`POST /api/project/delete`。被否，原因是资源语义上 DELETE 更直白，且现有路由已经是 `/api/project` 单入口。

### D7 全局带：选择器旁的项目菜单

`ProjectSelect` 保持纯受控（只负责切换）；新增 `src/project/ProjectMenu.tsx` 放在选择器右侧，两种状态：触发器按钮「项目 ▾」→ 弹层「新建项目 / 管理项目」。样式复用 `btn-mini`（非强调），不包在 `wb-bar-optional` 里，因此窄宽度不会被隐藏。镜头表里的 `+ 新建项目` 表单整块删除（连同 `newName/newTitle/creating/doCreate` 状态与 `wb-new` 样式引用）。

弹层用 `createPortal` + `fixed` 定位，沿用 `EpPicker` 的「窗口 resize/scroll 关闭、Esc 关闭、焦点归还」行为，保证外壳的键盘语义一致。

### D8 管理面板：一个组件两处入口

新增 `src/project/ProjectManagerDialog.tsx`：

```
+--------------------------------------------------------------+
| 项目管理                                          [关闭]      |
| [搜索项目名/标题]          已选 2 项      [删除选中]          |
| +----------------------------------------------------------+ |
| | [x] recycle        回收人 · E1 · 12 镜 · 2026-10-25      | |
| | [ ] verify-3d-...  0 镜                                  | |
| +----------------------------------------------------------+ |
| 删除确认（覆盖层）                                           |
|   即将删除 2 个项目：recycle、probe                          |
|   镜头 12 · 角色 3 · 成片 1 · 发布任务 0 · 媒体 324 KB        |
|   输入「recycle」确认  [输入框]        [取消] [确认删除]      |
+--------------------------------------------------------------+
```

- 列表来自 `GET /api/project`，删除前对每个选中项请求 `preview=delete` 并汇总。
- 单项确认输入项目名；批量确认输入选中数量。
- 删除后回调 `onDeleted(names)`；对话框保持打开并刷新列表，方便继续清理测试残留。
- 全局带「管理项目」与设置页「数据」分区都渲染这个组件（设置页内联为面板，全局带里是 modal）。

### D9 App 侧删除后的上下文回退

新增 `applyProjectDeletion(names: string[])`，顺序固定：

1. `setReadyProject('')`（先脱钩，阻止画布防抖回写）。
2. 对每个名字 `localStorage.removeItem(projectCanvasKey(name))`。
3. `await reloadProjects()`。
4. 若 `projectName` 在 `names` 里：`setProjectName(ps[0]?.name || '')`、`setEpNo(1)`、`setNodes([])`、`setEdges([])`、`setCharacters([])`、`setSelId(null)`。
5. 其余项目不受影响；不触发任何 `POST /api/project`。

画布加载 effect 已有 `readyProject !== projectName` 守卫，删除后 `readyProject=''` 会跳过写回；`projectName=''` 时水合分支直接返回空画布。

### D10 新建对话框从镜头表迁到全局带

`src/project/NewProjectDialog.tsx`：目录名 + 标题两个输入，沿用现有正则 `/^[a-zA-Z0-9_-]{1,40}$/` 与 `createProject()`；成功后 `onCreated(name)` → `reloadProjects()` → 切到新项目。镜头表不再持有创建状态，只保留 `onProjectsChanged` 回调（仍被拆镜保存后刷新镜数复用）。

## Risks / Trade-offs

- **删除不可逆，快照仅覆盖 DB 行** → 快照路径与「不恢复媒体」写进确认文案；快照写入失败即中止删除。
- **共享产物池残留成片与发布包** → 响应与界面明确说明，设置页给出产物目录路径供手工清理；不在本期做按项目反查。
- **过期标签页可能把已删除项目写回**（`writeProject` 对不存在项目隐式建骨架）→ 删除后前端立即刷新项目列表并重置上下文；服务端 `preview` 对不存在项目返回 `exists: false`。后续如需硬保证，可在 `writeProject` 增加 tombstone 校验，本期不做。
- **删除大项目时同步 I/O 阻塞事件循环** → 单个项目通常几十 MB；删除逐项执行，每项一个独立事务；真正卡顿时再改为队列任务，而不是用数量上限掩盖。
- **快照可能含敏感内容**（聊天记录、提示词）→ 落在本地 projects 根下的 `.deleted/`，不提交 git、不通过 HTTP 暴露；设置页提示可手工清理。
- **设置页与全局带两个入口的列表刷新不同步** → 两处都通过 `onDeleted` 回调让 App 统一 `reloadProjects()`，组件自身只刷新本地列表。

## Migration Plan

1. 服务端上线即生效，无表结构变更；已有项目无需迁移。
2. `.gitignore` 增加 `projects/.deleted/`；部署时该目录随 `SB_PROJECTS_DIR` 卷一起存在。
3. 前端上线后，镜头表的新建入口消失属预期变化；全局带出现「项目 ▾」。
4. 回滚：回退代码即可；已删除的项目只能从 `.deleted/*.json` 手工恢复，无法自动回滚。

## Open Questions

- 快照保留策略（按数量还是按天数自动清理）留待实际使用后决定；本期只写入不清理，由用户在设置页看到路径后自行管理。
