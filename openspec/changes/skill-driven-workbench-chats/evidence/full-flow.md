# 完整流程验收记录

日期：2026-10-24  
环境：macOS，Blender 本机安装，真实设置从 `projects/storyboard.sqlite` 复制到临时目录。  
目标：按 README 的「技能与工作台聊天」从剧本跑到 3D。

## 1. 五个内容阶段（真实模型）

命令：`node verify-skills-real.mjs`  
模型：MiniMax M3（设置默认文本模型）

| 阶段 | 真实调用 | 输出形状 | 耗时 |
| --- | --- | --- | --- |
| 剧本 | ✅ | `episodes[]` | 9s |
| 角色 | ✅ | `characters[]` | 5s |
| 素材 | ✅ | `scenes[]` / `props[]` | 3s |
| 镜头表 | ✅ | `shots[]` | 4s |
| 提示词 | ✅ | `shots[].keyframe_prompt` + `video_prompt` | 3s |

说明：这个 smoke 校验技能文件组装出的 system/task、真实模型调用和 JSON 形状；不写项目、不写线程。  
剧本示例产出：`雨巷旧影`，钩子为旧搭档摘下面罩；镜头示例 `S01` 为特写/固定，提示词带 `{{陈默}}` 锚点。

## 2. 3D 真实生产尝试

命令：`AGENT_REAL=1 APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs`  
场景：山体背景、男女持剑对打、4 秒环绕、镜头正对两人。

| 尝试 | 代码模型 | 结果 | 产物 |
| --- | --- | --- | --- |
| 1 | MiniMax M3（`minimax-text`） | 代码 390 行，hash `23a0df0c43`；关键帧自检声称 5 帧通过，但 MP4 帧验收 5/6，未通过「环绕」；按门禁不保存 | `agent-duel-real.mp4`（4.0s，960x540 候选）、`agent-duel-real.png` |
| 2 | DeepSeek V4 Pro（`ark-plan-text-deepseek`） | 300 秒总时长超时，仍在分片追加草稿 | 无 |
| 3 | DeepSeek Flash（`ark-plan-text-deepseek-flash`） | 160 行代码提交，渲染试运行报 `[init] name 'man_cloth' is not defined`；修复 3 次上限 | 无 |
| 4 | Kimi K3（`ark-plan-text-kimi`） | 代码通过试运行并抓 5 帧；视觉验收 2 次上限，未通过「环绕 + 两人始终居中」 | 无 MP4 |
| 5 | 豆包 2.1 Pro（`ark-plan-text-pro`） | 300 秒总时长超时，第 2 轮后失败 | 无 |

结论：真实 3D 代码生成在当前模型与门禁下没有完成「代码 → 试运行 → 抓帧 → 视觉验收 → MP4 保存」全链路。失败点分别是模型超时、代码运行错误和视觉验收未通过；不是聊天 UI 回归，也不是 3D 运行时崩溃。

## 3. 3D 机制路径（mock 模型 + 真实 Blender）

命令：`APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs`（默认 mock）

结果：全部通过。  
产物：

- `agent-duel.mp4`：4.0s，960x540，MP4 帧验收 7/7 通过。
- `agent-duel-frame-0.jpg` … `agent-duel-frame-4.jpg`：5 张关键帧。
- `agent-duel.png`：工作台截图。
- 代码 hash `21b03761ff`，与保存后的项目一致。

这条路径证明共享聊天壳、工具卡、草稿、试运行、抓帧、视觉门禁和 MP4 保存仍然工作；它不证明真实代码模型能稳定生成合格场景。

## 4. 结论与后续

- README 与设置页说明已更新：技能来源/版本/覆盖、锁定契约、3D 线程恢复、只读技能边界、聊天入口与面板宽度/窄屏行为、写回执语义。
- 五阶段真实文本链路通过；真实 3D 链路仍被模型可靠性/视觉门禁阻塞。
- 建议单独开一个 3D 代码可靠性变更：候选方向包括场景代码模板化、环绕相机数值自检（先验证相机轨迹再抓帧）、提高总时长/修复次数、或固定 fixture 作为真实流程的基线；不要把 mock 通过当作真实模型通过。
- 因此 `4.7` 保持未完成；等真实 3D 链路通过后再勾选。
