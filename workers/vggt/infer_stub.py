#!/usr/bin/env python3
"""
VGGT Worker 壳（POC）：接收帧目录路径，返回 report v1 JSON。
部署前在 run_vggt() 内接入 facebookresearch/vggt 推理。
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


def run_vggt(payload: dict) -> dict:
    """TODO: 加载 VGGT，对 framesDir 内 jpg 序列推理，填充 keyframes。"""
    probe = payload.get("probe") or {}
    duration = float(probe.get("duration") or 6)
    aspect = payload.get("projectAspect") or "16:9"
    eff = float(payload.get("effectiveSeconds") or duration)
    return {
        "version": 1,
        "sourceFingerprint": "sha256:stub",
        "probe": probe,
        "confidence": "low",
        "scaleHint": {
            "unit": "relative",
            "sceneExtentM": None,
            "note": "stub：未接 VGGT",
        },
        "sampleCount": int(payload.get("frameCount") or 0),
        "keyframes": [
            {
                "t": 0,
                "position": [0, 0, 0],
                "rotationQuat": [1, 0, 0, 0],
                "fovDeg": 54,
                "confidence": 0.5,
            }
        ],
        "motionSummaryZh": "（stub）请在 run_vggt 中接入真实推理。",
        "mappingNote": f"项目画幅 {aspect}；有效出片 {eff}s。",
        "warnings": ["Worker stub：未运行 VGGT 模型"],
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path != "/v1/infer":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        report = run_vggt(body)
        out = json.dumps({"ok": True, "report": report}, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(os.environ.get("VGGT_WORKER_PORT", "8765"))
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
