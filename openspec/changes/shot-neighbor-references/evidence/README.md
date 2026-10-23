# 相邻分镜参考验收

## 截图

- `neighbor-menu.png`：S02 的参考菜单只出现「上一镜 S01 / 下一镜 S03」，二者都有当前画面和「首帧」动作；没有更远的 S04，也没有尾帧入口。

## 自动化

- `verify-neighbor-refs.mjs`：纯函数覆盖同集数值排序、S2/S10、首末镜、跨集、自引用、关系 token、重排、10/4 上限和缺失。
- `verify-neighbor-ui.mjs`：右键只出现相邻镜；手动勾选写入 `shot-prev`；不自动写 `shot-next`；不新增参考边；画面/视频请求都带相邻图；视频最多 4 张并提示省略；下一镜未出图禁用；首帧动作只改当前镜；旧 `tail_image` 项目无尾帧 UI、旧视频仍显示。
- `verify-video-ref-ui.mjs`：参考视频 + 相邻 `reference_image`，请求无首帧/尾帧/cameraFixed；1.0 首帧模式无尾帧。
- `verify-video-api.mjs`：请求体不再有 `last_frame` / `return_last_frame`，只下载视频。
- `verify-tail.mjs`：源码/主题中没有尾帧字段与 UI 残留。
- `verify-schedule3d.mjs`、`verify-code-*`、`verify-project-scope.mjs`、`verify-theme.mjs`：回归通过。

## 协调说明

`canvas-video-api` 与 `schedule-video-reference` 仍未归档，且规格中保留尾帧要求；本变更的 Workflow follow-up 要求在实施/归档前先修订或归档它们。
