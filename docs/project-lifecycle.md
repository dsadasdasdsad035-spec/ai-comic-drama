# 项目生命周期

项目是全站唯一数据边界。这份文档说明项目怎么新建、删除会影响什么、快照在哪里，以及哪些文件不会被删除。

## 新建项目

入口在**顶栏全局带**、项目选择器右侧的「项目 ▾」按钮里：

```
顶栏   项目 [a ▾] [项目 ▾] [E01 ▾]    剧本 角色 素材 镜头表 提示词 画布 发布 设置
```

点「项目 ▾」→「新建项目」，填两项：

| 字段 | 规则 |
| --- | --- |
| 目录名 | 字母、数字、下划线、短横，1–40 字符；同时是项目目录名，必填 |
| 标题 | 可空，只用于顶栏下拉显示；留空时用目录名 |

创建成功后会自动切到新项目。同名项目会报错且不覆盖已有数据。

> 早期版本的新建按钮在「镜头表」工具条里，内容列窄于 1100px 时会被整块 `display:none`（开着聊天面板就会消失）。现在入口移到了全局带，窄宽度下依然可用。

「创意」会话也能产出项目：晋升对话框里选「新建项目」。

## 删除项目

同一入口的「项目 ▾」→「管理项目…」，或设置页 →「数据」→「项目管理」。两处是同一个面板。

面板提供搜索、全选当前、单选删除与「删除选中」。删除分三步：

1. **预览**：按选中项目逐个请求影响范围，显示镜头、角色、素材、设定、集、场次、场景布局、在线素材留档、聊天线程、成片、发布任务/意图/事件的行数，以及项目媒体目录体积。
2. **确认**：单项目要求输入**项目名**；批量要求输入**选中数量**。文本不符时确认按钮禁用，不发请求。
3. **执行**：服务端先写快照，再在一个事务里级联删除，提交成功后才清理文件。

### 活动发布任务会挡住删除

项目只要有处于 `draft` / `queued` / `uploading` / `awaiting_user` / `awaiting_confirmation` / `submitted` 的发布任务，删除会被拒绝（HTTP 409），返回任务清单。系统不会替你取消任务——先到发布台处理或取消它们，再回来删。

> 服务重启会把未完成任务标成 `unknown`（终态），这属于正常恢复流程，不再阻止删除。

### 级联范围

| 表 | 关联键 |
| --- | --- |
| `shots`、`characters`、`assets`、`designs`、`scenes`、`episodes`、`scene_layouts`、`stock_imports` | `project_id` |
| `chat_threads`、`publish_jobs`、`publish_intents`、`deliverables` | 项目名字符串 |
| `publish_events` | `job_id` 子查询（先于 `publish_jobs` 删除） |
| `projects` | 主表行 |

数据库没有声明外键，删除不会自动级联，所以清单写在 `server/project-lifecycle.mjs` 的 `PROJECT_CASCADE` 里。新增项目域表时要同步加进这张清单，并在 `verify-project-lifecycle.mjs` 的「无孤儿行」断言里覆盖。

### 被删除 vs 保留

**会删**：项目 SQLite 行与上述全部子表行；`<项目根>/<项目>/` 整个目录（含 `assets/` 媒体）；`<appRoot>/.scene-drafts/<项目>/` 下的 3D 草稿。

**不会删**（共享产物池，扁平命名、可能与已发布内容关联）：

- `public/exports/` — 成片导出与导入
- `public/publish-packages/` — 离线发布包
- `public/generated/` — 生成图片
- `public/videos/`、`public/voices/` — 视频与配音产物
- `.publish-profiles/` — 平台登录态（按账号存，跨项目共享）
- 已发布到平台的内容 — 本地删除不会撤回

需要清理共享文件时手工处理；删除响应里固定带 `sharedFilesKept: true` 说明这一点。

## 删除快照

删除前服务端会把主表行与全部级联表行写成一份 JSON：

```
<SB_PROJECTS_DIR>/.deleted/<项目名>-<ISO 时间戳>.json
```

本地开发默认 `<仓库>/projects/.deleted/`，Docker 部署是 `/data/projects/.deleted/`。该目录已加入 `.gitignore`，不通过 HTTP 暴露。

结构：

```json
{
  "version": 1,
  "projectsRoot": "/path/to/projects",
  "deletedAt": "2026-10-27T11:56:52.635Z",
  "project": { "id": 42, "name": "my-drama", "title": "回收人", "aspect": "16:9" },
  "tables": {
    "shots": [ { "shot_id": "...", "desc": "..." } ],
    "characters": [],
    "assets": [],
    "designs": [],
    "scenes": [],
    "episodes": [],
    "scene_layouts": [],
    "stock_imports": [],
    "chat_threads": [],
    "publish_events": [],
    "publish_jobs": [],
    "publish_intents": [],
    "deliverables": []
  }
}
```

快照写入是删除的前置条件：写不进去（磁盘满、权限不足、目录被占）就中止删除，项目数据保持原样。

### 手工恢复的样子

没有自动恢复入口，需要时按快照手工重建：

1. 停掉 dev server，避免 WAL 写锁。
2. 备份当前库：`sqlite3 projects/storyboard.sqlite ".backup 'projects/pre-restore.sqlite'"`（必须用 `.backup`，直接 `cp` 会漏掉 WAL 里的最新内容）。
3. 用 `INSERT INTO projects (...) VALUES (...)` 写回 `snapshot.project`，拿到新的 `project_id`。
4. 对 `tables` 里的每一张表，把行写回并把 `project_id` 换成新 id；`chat_threads` / `deliverables` / `publish_jobs` / `publish_intents` 按项目名写回；`publish_events` 按恢复后的 `publish_jobs.id` 写回。
5. 媒体文件**不在快照里**。如果之前有备份，把它放回 `<项目根>/<项目名>/assets/`；没有就只能重新生成参考图。

## 删除之后的全局上下文

- 删的是**当前项目**：前端先让画布加载状态脱钩，清掉 `localStorage['storyboard-canvas-v1:<项目名>']`，再重载项目列表，切到剩余第一个项目或「未选项目」；集号回到 1，画布节点与连线清空。
- 删的是**别的项目**：当前项目与各视图不变，只是列表少一项。
- 删到**一个不剩**：顶栏显示「（无项目）」，项目视图进入空状态，系统不会自动建项目。
- 画布 key 必须清掉：否则用同名新建项目后，旧画布会整份捞回来。

## 相关文件

| 文件 | 职责 |
| --- | --- |
| `server/project-lifecycle.mjs` | 删除清单、预览、快照、级联事务、文件清理 |
| `server/project-lifecycle.d.mts` | 类型声明 |
| `src/project/ProjectMenu.tsx` | 全局带入口与弹层 |
| `src/project/NewProjectDialog.tsx` | 新建对话框 |
| `src/project/ProjectManagerDialog.tsx` | 管理面板（弹窗与设置页内联共用） |
| `src/api.ts` | `previewProjectDelete` / `deleteProjects` |
| `vite.config.ts` | `GET ?preview=delete`、`DELETE ?name=`、`DELETE ?names=` |
| `verify-project-lifecycle.mjs` | 服务端、API、界面三段验收 |

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/project?name=<项目>&preview=delete` | 单项目只读预览；不存在返回 `exists:false`；非法名 400 |
| `POST` | `/api/project?preview=delete` + `{names:[...]}` | 批量预览，一次算完；逐项 `items`，非法名该条带 `message` |
| `DELETE` | `/api/project?name=<项目>` | 单删；成功 200，活动任务 409，不存在 404 |
| `DELETE` | `/api/project` + `{names:[...]}` | 批量删除，逐项结果，即使部分失败也返回 200 |
| `DELETE` | `/api/project?names=a,b,c` | 同上，兼容用查询串的旧写法（名字多时会被 URL 长度限制，前端已改用请求体） |

批量删除**不设数量上限**：一次清掉几百个测试项目是正常用法。名字走请求体，避免几百个长名字撑爆 URL；服务端逐个执行，每项独立快照、独立事务，单项失败不影响其他项。

## 验收

```bash
node verify-project-lifecycle.mjs
```

脚本自建临时 `SB_PROJECTS_DIR` 与临时 dev server，覆盖：删除清单完整性、预览计数与只读性、快照失败中止、跨 13 张表的级联、其他项目不受影响、同名重建为空、活动任务拦截、批量部分失败、共享产物保留、全局带入口在窄宽度可见、新建对话框、管理面板搜索与确认文本、删除后上下文回退与画布 key 清除、删到空库。
