# 3D 聊天 + MP4 验收 — 测试包

## 内容

| 文件 | 用途 |
|------|------|
| `scene3d-chat-mp4-test.json` | 镜头元数据、用户口语、视觉清单 |
| `agent-duel-scene.py` | 固定 Blender 场景（山 / 男女 / 双剑 / 环绕），符合 ABI |

## 前置

1. 开发服务：`npm run dev`（默认 `http://127.0.0.1:5280` 或终端里 Vite 提示的端口）
2. 本机 **Blender** 可用：`curl -s $APP_URL/api/blender/health` 应 `ok: true`
3. 可选 **ffprobe**（校验 MP4 时长）

## 一键验收（推荐）

```bash
# mock 模型，真实 Blender 渲染 + 真实 MP4 保存
APP_URL=http://127.0.0.1:5280 node verify-scene3d-chat-mp4.mjs

# 真实 Chrome 窗口（可看到 3D 聊天与 MP4 卡片；默认多留 12s 再关窗）
HEADED=1 APP_URL=http://127.0.0.1:5274 node verify-scene3d-chat-mp4.mjs
HEADED=1 HEADED_PAUSE_MS=30000 SLOW_MO=120 APP_URL=... node verify-scene3d-chat-mp4.mjs

# 走真实 sceneCode 模型（需设置里已绑定模型）
AGENT_REAL=1 APP_URL=http://127.0.0.1:5280 node verify-scene3d-chat-mp4.mjs
```

证据输出：`fixtures/evidence-scene3d-chat-mp4/`（截图、清单 JSON、可选 mp4 副本）

## 手动点测

1. 新建或打开项目，在镜头表建好 `E01-S01`（可参考 JSON 字段）。
2. **3D 调度** → 打开镜头 → **3D 聊天**。
3. 发送 `scene3d-chat-mp4-test.json` 里的 `userPrompt`。
4. 等待 agent：`试运行` → `抓帧` → `清单` → `代码阶段完成` → **MP4 视频验收** → `已保存`。

mock 验收与 `verify-scene3d-chat-mp4.mjs` 使用相同工具顺序；真实模型应自行写码或 `scene/main.py` + `adopt_scene_from_job`。
