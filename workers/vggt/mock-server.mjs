/**
 * 本地 mock VGGT Worker：POST /v1/infer → report.sample.json 变体。
 * 用法：node workers/vggt/mock-server.mjs
 * 环境：VGGT_MOCK_PORT（默认 8765）
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.VGGT_MOCK_PORT) || 8765
const sample = JSON.parse(fs.readFileSync(path.join(__dir, 'report.sample.json'), 'utf8'))

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, mock: true }))
    return
  }
  if (req.method === 'POST' && req.url === '/v1/infer') {
    try {
      const need = String(process.env.VGGT_WORKER_TOKEN || '').trim()
      if (need) {
        const auth = String(req.headers.authorization || '')
        if (auth !== `Bearer ${need}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: '未授权' }))
          return
        }
      }
      const body = await readBody(req)
      const probe = body?.probe || sample.probe
      const report = {
        ...sample,
        sourceFingerprint: `sha256:${crypto.createHash('sha256').update(JSON.stringify(probe)).digest('hex').slice(0, 16)}`,
        probe,
        mappingNote: `已按项目 ${body?.projectAspect || '16:9'}；有效出片 ${body?.effectiveSeconds ?? probe?.duration ?? 6}s。`,
        sampleCount: Number(body?.frameCount) || sample.sampleCount,
        warnings: [...(sample.warnings || []), 'mock Worker 输出'],
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, report }))
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
    }
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`VGGT mock worker http://127.0.0.1:${PORT}/v1/infer`)
})
