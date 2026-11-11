# VGGT 参考片几何 Worker（POC）

本目录**不**纳入 `npm install`。Mac 开发机跑 `npm run dev`，几何推理在 **Linux + NVIDIA GPU** 的 Worker 上执行。

## 快速本地（无 GPU）

```bash
node workers/vggt/mock-server.mjs
# 开发机 .env 或 shell：
export VGGT_WORKER_URL=http://127.0.0.1:8765
```

## 真实 VGGT（Linux）

1. 克隆 [facebookresearch/vggt](https://github.com/facebookresearch/vggt)，按官方 README 安装依赖与权重。
2. 实现 `POST /v1/infer`，请求体：

```json
{
  "framesDir": "/abs/path/to/frames",
  "probe": { "duration": 6, "width": 1920, "height": 1080, "fps": 24 },
  "projectAspect": "16:9",
  "effectiveSeconds": 6,
  "frameCount": 12
}
```

3. 响应：

```json
{ "ok": true, "report": { "...": "见 report.schema.json" } }
```

4. 坐标：首帧相机为原点；`rotationQuat` 为 **wxyz**；FOV 为度。

可选起点：`infer_stub.py`（HTTP 壳，推理处 TODO 接 VGGT）。

## 报告校验

```bash
node workers/vggt/validate-report.mjs workers/vggt/report.sample.json
```

## Gate 验收

见 `openspec/changes/vggt-reference-camera-poc/evidence/GATE.md`。
