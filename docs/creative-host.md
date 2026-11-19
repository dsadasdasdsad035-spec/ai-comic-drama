# 创意会话宿主（dsh runtime）

创意页不再是应用自己渲染的聊天界面，而是一个同源 iframe，指向由本应用拉起的
`@deepseek-ai/dsh` 进程。应用这一侧只保留三件事：入口、主题桥、工具桥。

- 入口：`/studio/`（反代到宿主）
- 主题桥：`src/creative/StudioFrame.tsx`
- 工具桥：`server/studio-tool-bridge.mjs` + `server/dsh-plugins/creative-tools`

## 运行前提

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Node | **24+** | 用到 `node:sqlite` 与原生 ESM 类型剥离；22 及以下会直接起不来 |
| `@deepseek-ai/dsh` | `0.2.2-rc.5` | 与 `package.json` 一致；升级要重跑宿主相关测试 |
| 磁盘 | 状态根可写 | `DSH_HOME` 指到 `<状态根>/dsh`，见下 |

## `DSH_HOME` 在哪

宿主把会话、日志与 profile 都写在 `DSH_HOME` 下。本应用固定指向：

```
<SB_STATE_ROOT>/dsh/
├── profiles/web/            # profile 清单、模型 patch、专家 preset
├── experts/                 # 自定义专家（manifest.json + soul.md）
│   └── compiled/            # 内置/自定义专家的可读快照与编译结果
└── sessions/                # 会话日志（宿主自己维护）
```

`SB_STATE_ROOT` 默认是应用根目录；容器里映射到 `./data/state`。
**这个目录不可丢**：会话与专家都在里面。备份清单见 `docs/deploy.md`。

## 反代与长连接

创意页与宿主之间有一条 WebSocket 长连接，反代必须显式放行：

```nginx
location /studio/ {
    proxy_pass         http://127.0.0.1:5273;
    proxy_http_version 1.1;

    # 宿主的会话流是长连接：超时太短会出现「回答到一半断线」
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    # 宿主校验 Host，转发时必须带原始 Host
    proxy_set_header   Host $http_host;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

宿主自身只监听 `127.0.0.1`，不对外暴露端口；所有访问都经应用这一层。

## 入口开关（灰度）

设置键 `studioEnabled`（环境变量 `SB_STUDIO` 只作默认值）：

```bash
# 当前状态
curl -s http://127.0.0.1:5273/api/studio/enabled

# 关掉：入口立即从左栏消失，宿主被停掉，/studio/ 返回中文说明
curl -s -X POST http://127.0.0.1:5273/api/studio/enabled \
  -H 'Content-Type: application/json' -d '{"enabled":false}'
```

关掉后创意页不可进入，其余视图（概览/素材/画布/设置）完全不受影响。
重新打开不需要重启应用，下一次进入创意页会重新拉起宿主。

## 依赖收口：Pi 与 assistant-ui

创意页迁移后，**创意这条链路不再引用** `@earendil-works/pi-agent-core`、
`@earendil-works/pi-ai` 与 `@assistant-ui/react`：创意前端模块已删除，
会话循环由宿主负责，消息渲染由宿主前端负责。

但三个依赖仍被**工作台聊天**使用（3D/白模工作台、五个工作台、发布助手），
它们共用 `src/agent/pi/engine.ts` 的 `Agent` 与 `src/chat-ui` 的
assistant-ui runtime：

| 依赖 | 剩余使用点 | 结论 |
| --- | --- | --- |
| `@earendil-works/pi-agent-core` | `src/agent/pi/*`（工作台执行引擎） | **保留**：删掉会让所有工作台聊天停摆 |
| `@earendil-works/pi-ai` | `src/agent/pi/{streamFn,messages,stageRunner}.ts` | **保留**：Pi 引擎的消息与流类型 |
| `@assistant-ui/react` | `src/chat-ui/*`、`src/agent/stageToolUis.tsx` | **保留**：工作台聊天的消息 runtime 与工具卡 |

因此本次不移除依赖。新增创意代码不得再 import 这三个包；
若将来要把工作台也迁到宿主，再整体移除，并同步删除 `src/agent/pi` 与 `src/chat-ui`。

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 创意页显示「创意会话暂时不可用」 | 宿主未装/启动失败 | 看应用日志里的 `[creative-host]`；错误页「重试」会重新拉起 |
| 一直「正在连接创意会话」 | 宿主启动慢或反代没放行 WebSocket | 检查 `/studio/_host/status` 的 `state` 与反代配置 |
| 专家列表为空 | 专家编译失败 | 看 `[studio-experts]` 日志；确认 `<DSH_HOME>/profiles/web/creative-experts.patch.yml` 存在 |
| 新专家选了但没生效 | preset 只在宿主启动时读取 | 保存设置后应用会自动重启宿主；仍不行就重开创意页 |
| 工具调用一律「未授权」 | 内部令牌缺失 | 宿主需要 `SB_STUDIO_INTERNAL_TOKEN`，由应用注入，不要手工改 |
