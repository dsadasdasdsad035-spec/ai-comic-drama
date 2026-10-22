# Design

## Context

当前所有生成图都落在 `public/generated/`，项目数据库只保存 `/generated/<file>` 字符串；`public/generated/` 被 gitignore，和项目数据有完全不同的生命周期。角色三视图、场景/道具设定图都是长效参考图，工作区搬迁或产物清理后就会变成悬空引用。此外角色图片生成/上传只经过 1.2 秒防抖回写，上传的 dataURL 还会被 `toProject()` 主动丢弃。

现有可复用的基础：

- `resolveRoot()` 已把项目根解析到 `projects/`（或 `SB_PROJECTS_DIR`），`.gitignore` 已经预留 `projects/*/assets/`。
- `/api/project` 是所有视图读取项目数据的唯一入口，`readProject`/`writeProject` 已经按字段合并。
- `resolveRef()` 已经把本地相对路径转换成本地图片给方舟；`serveFile()` 已支持 range 与 `no-cache`。
- 角色/设定图引用在项目数据里是纯字符串，客户端 `local()` 只要求以 `/` 开头，不限制具体前缀。

## Goals / Non-Goals

**Goals:**

- 角色三视图与场景/道具设定图存入 `projects/<项目>/assets/`，用项目级 URL 访问，项目目录可独立搬迁。
- 旧 `/generated/...` 引用在项目打开时幂等迁移；迁移后 `public/generated/` 被清空也不影响已迁移图片。
- 文件缺失在 UI 和生成链路中都有明确表现，不再空白或静默降级。
- 角色图片生成/上传后立即持久化，上传不再保存 dataURL。

**Non-Goals:**

- 不迁移镜头首帧、调度帧、视频、配音等可重生成、体积大的产物。
- 不引入对象存储、数据库 BLOB、鉴权或多用户隔离。
- 不自动从任意旧目录扫描恢复文件；恢复仍由用户显式放置或重新生成。
- 不改动生图/视频模型、提示词和候选数量。

## Decisions

### 1. 项目媒体目录放在 `projects/<项目>/assets/`

`projects/<项目>/assets/` 与项目数据库同处 `projects/` 树下（`resolveRoot()`），文件名扁平保存，URL 为 `/project-assets/<项目>/<文件>`。

- 为什么不放 `public/projects/`：`public/` 是应用资源目录，清理/重建工作区时仍会一起丢；放在 `projects/` 才能和项目数据同生命周期。
- 为什么不存 DB BLOB：会撑大 SQLite、失去 range/浏览器缓存，而且现有 URL 引用模型要整体重写。
- 为什么扁平：生成文件名本身带时间戳和随机后缀，扁平目录已经足够；避免多层路径带来的穿越校验复杂度。
- 新文件统一用 `char-<ts>-<rand>.<ext>` / `design-<ts>-<rand>.<ext>`；迁移沿用旧 basename，便于按文件名定位。

### 2. 项目级 URL 由同一中间件提供，`resolveRef` 同步支持

- 静态路由：`/project-assets/<name>/<file>` 在 vite 中间件里解析，`decodeURIComponent` 后过 `safeProjectName()`、`path.basename(file) === file`，并校验最终路径位于该项目 assets 目录内；命中后复用 `serveFile()`。
- `resolveRef()` 迁入 `server/media.mjs` 并保持 `(ref, root)` 签名，增加 `/project-assets/` 分支：通过 `resolveRoot(root)` 定位项目目录，读取文件后转成 dataURL；旧的 `/generated/...` 分支保留。迁出后可以脱离 Vite 单测新旧两种路径。
- 这样浏览器 `<img>`、方舟参考图、候选切换都只处理一种字符串，不需要客户端分支判断。

### 3. `/api/seedream` 与 `/api/save-image` 接受可选 `project`

- `generateImage()` 增加 `project?: string`。角色板（`cap: 'view'`）和素材板传入当前项目；镜头出图不传，继续写 `public/generated/`。
- `/api/seedream` 下载完图片后，有 `project` 就写项目媒体目录并返回 `/project-assets/...`，没有就保持现有 `public/generated/` 行为。前缀按 `cap` 取 `char` / `design`。
- `/api/save-image` 增加 `project`，上传的角色图由服务端解码 dataURL 后写项目目录并返回文件 URL；没有 `project` 时维持现状（调度图等）。
- 上传失败、格式不支持、超过参考图 30MB 上限时返回 400 和可读错误，客户端仅在成功后替换图片。

### 4. 迁移放在 `GET /api/project`，同步、幂等、返回缺失清单

项目读取时先迁移再读取：

1. 读取项目，遍历 `characters.image/candidates` 和 `designs.image/candidates`。
2. `/generated/<file>` 引用：先看 `projects/<项目>/assets/<file>` 是否已存在；不存在且 `public/generated/<file>` 存在，则 `copyFileSync`（不 move）到项目目录；找到文件就改写为 `/project-assets/...`。
3. `/project-assets/...` 引用：文件存在则保留，不存在则记入缺失。
4. 其他前缀（`http`、`data:`）跳过。
5. 有改写就 `writeProject(root, name, { characters, designs })`；返回 `project.media = { migrated, missing }`。

- 为什么放在 GET：所有视图（App、AssetBoard、PromptTable）都走 `/api/project`，一个入口就能保证看到的数据已迁移，不需要客户端协调额外请求和重载。
- 为什么可以接受 GET 有副作用：迁移是同步 IO、无 await，天然不会和并发的 POST 交错；重复调用只做 `existsSync` 检查；失败不影响项目读取。
- 为什么不 move：画布 localStorage 里的旧素材卡仍存着 `/generated/...`，保留公共文件可避免它们立即失效；下次发布/更新画布时会拿到项目 URL。
- 为什么缺失不自动改写成新路径：指向不存在文件的新 URL 会让问题更难诊断；保留原引用并在 `media.missing` 中报告。

### 5. 缺失状态由服务端清单驱动，客户端兜底 `onError`

- App 加载项目时把 `project.media.missing` 存成 `Set<string>`，传给角色板和素材板。
- 角色卡：选中图在缺失集合里时显示「图片文件缺失」和「重新生成 / 清除引用」，不再渲染空白 `<img>`；候选点仍保留，用户可切到未缺失的候选。`<img onError>` 作为页面打开后文件被删的兜底，同样标记缺失。
- 画布角色节点：图片缺失时回退到名字首字占位，不显示破图。
- 素材板：设定卡同样显示缺失提示，「加入画布」在图片缺失时直接提示重新生成。
- 出图前检查：`generateOne` 收集参考图时，若角色图在缺失集合里，直接抛出「角色「X」的三视图文件缺失，请先重新生成」，不发出带无效参考图的请求。
- 清除引用走即时保存，确保刷新后仍是「待生成」。

### 6. 图片操作即时保存，文本编辑保留防抖

- `patchCharacter` 改为返回更新后的角色数组，并同步更新 `charactersRef`；角色板在生成、上传、清除、切换候选后调用新的 `onPersist(next)`。
- App 的 `onPersist` 直接 `patchProject(name, { characters: next.map(toProject) })`，成功后只在这时推进 `charSnapRef`；失败 `toast` 提示，不推进快照，现有 1.2 秒防抖会再重试一次。
- 文本输入仍走原防抖，避免每次按键发请求。即时保存成功后快照一致，防抖定时器会自然跳过。
- 素材板同理：设定图生成完成后立即 `patchProject({ designs })` 并推进 `savedSigRef`，避免同样的防抖丢失窗口；文本编辑继续防抖。

## Risks / Trade-offs

- [GET 触发写迁移] → 迁移同步执行、只复制不移动、`existsSync` 幂等；任何异常按单文件吞掉并记入缺失，保证项目仍能打开。
- [迁移后公共目录与项目目录各存一份] → 只对旧的少量角色/设定图发生；新生成图只写项目目录，镜头级产物不参与，体积可控。
- [项目改名/删除时媒体目录未跟随] → 当前产品没有项目改名/删除 API；若后续新增，必须同步移动/清理 `projects/<项目>/assets/`。风险写入后续变更说明，不在本次实现。
- [旧图已彻底缺失无法自动恢复] → UI 明确标记缺失；迁移会优先按 basename 查项目目录，用户把同名文件放进 `projects/<项目>/assets/` 后下次打开即可自动改写，否者重新生成。
- [回滚不彻底] → 新 URL 依赖新中间件，直接回退代码会让新图片 404；回滚前需把项目媒体复制回 `public/generated/` 并改写引用，或接受重新生成。当前是本地单用户工具，接受此成本。
- [角色名/项目名含特殊字符] → 项目名继续受 `safeProjectName()` 限制；文件 URL 使用 `encodeURIComponent`，文件名只允许 basename。

## Migration Plan

1. 部署后首次打开项目：`GET /api/project` 自动迁移仍存在的旧图，`project.media.migrated` 用于一次性提示「已把 N 张参考图收进项目目录」。
2. 当前项目 8 张已缺失的角色图：从旧工作区备份的 `public/generated` 复制同名文件到 `projects/<项目>/assets/`，下次打开项目时迁移按 basename 命中并改写；或直接在角色板重新生成。
3. 迁移完成后可安全清理 `public/generated/` 中的旧角色/设定图；镜头首帧等其它产物不受影响。
4. 回滚：先保留一份项目媒体并改写回 `/generated/...`，再回退代码；否则新图片在旧代码下不可访问。
