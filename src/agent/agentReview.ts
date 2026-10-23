import type { AppSettings } from '../api'
import { askVision } from '../api'
import { stageModelKey, type StagePick } from '../ModelSelect'
import type { AgentFrame, AgentReview, AgentReviewItem } from './sceneAgentTypes'

const W = 1400
const H = 900

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    const timer = window.setTimeout(() => resolve(null), 5000)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve(null)
    }
    img.src = url
  })
}

async function buildSheet(frames: AgentFrame[]): Promise<string> {
  if (typeof document === 'undefined' || !frames.length) return ''
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#10161d'
  ctx.fillRect(0, 0, W, H)
  const cols = 3
  const rows = Math.max(1, Math.ceil(frames.length / cols))
  const pad = 16
  const labelH = 34
  const cellW = (W - pad * 2 - pad * (cols - 1)) / cols
  const cellH = (H - pad * 2 - pad * (rows - 1)) / rows
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const img = await loadImage(frame.url)
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = pad + col * (cellW + pad)
    const y = pad + row * (cellH + pad)
    ctx.fillStyle = '#18222c'
    ctx.fillRect(x, y, cellW, cellH)
    ctx.strokeStyle = '#385066'
    ctx.strokeRect(x, y, cellW, cellH)
    ctx.fillStyle = '#dce8f3'
    ctx.font = 'bold 20px system-ui, sans-serif'
    ctx.fillText(`FRAME @ ${Number(frame.t).toFixed(2)}s`, x + 12, y + 24)
    if (img) {
      const maxW = cellW - 24
      const maxH = cellH - labelH - 24
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)
      const dw = img.naturalWidth * scale
      const dh = img.naturalHeight * scale
      ctx.drawImage(img, x + 12 + (maxW - dw) / 2, y + labelH + 12 + (maxH - dh) / 2, dw, dh)
    } else {
      ctx.fillStyle = '#6f8295'
      ctx.fillText('FRAME MISSING', x + 20, y + labelH + 38)
    }
  }
  return canvas.toDataURL('image/jpeg', 0.84)
}

function normalizeItems(raw: unknown, requirements: string[]): AgentReviewItem[] {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = Array.isArray(o.items) ? o.items : []
  const out: AgentReviewItem[] = []
  for (let i = 0; i < requirements.length; i++) {
    const req = requirements[i]
    const matched =
      list
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .find((x) => {
          if (!x) return false
          const key = String(x.key || x.label || '').toLowerCase()
          return key === req.toLowerCase() || key.includes(req.toLowerCase()) || req.toLowerCase().includes(key)
        }) || (list[i] && typeof list[i] === 'object' ? (list[i] as Record<string, unknown>) : null)
    out.push({
      key: String(matched?.key || `req-${i}`),
      label: req,
      ok: Boolean(matched?.ok),
      ...(matched?.reason ? { reason: String(matched.reason).slice(0, 200) } : {}),
    })
  }
  return out
}

/** 基于关键帧的视觉初筛；没有视觉模型或调用失败时明确转人工。 */
export async function reviewFramesWithVision(input: {
  frames: AgentFrame[]
  requirements: string[]
  settings: AppSettings | null
  stagePick?: StagePick
  signal?: AbortSignal
}): Promise<AgentReview> {
  const modelKey = stageModelKey(input.settings, 'vision', input.stagePick)
  if (!modelKey) {
    return {
      passed: false,
      usedVision: false,
      needsHumanReview: true,
      items: input.requirements.map((label, i) => ({
        key: `req-${i}`,
        label,
        ok: false,
        reason: '未配置视觉模型',
      })),
      summary: '未配置视觉模型，需要人工检查关键帧',
    }
  }
  const sheet = await buildSheet(input.frames)
  if (!sheet) {
    return {
      passed: false,
      usedVision: false,
      needsHumanReview: true,
      items: input.requirements.map((label, i) => ({ key: `req-${i}`, label, ok: false, reason: '参考图不可用' })),
      summary: '关键帧不可用，需要人工检查',
    }
  }
  try {
    const r = await askVision({
      system: '你是 3D 场景验收员。只根据关键帧判断清单，每项给出 ok 和 reason；不要臆造画面里没有的内容。',
      prompt:
        `请检查以下场景要求：\n${input.requirements.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n\n` +
        '只输出 JSON：{"summary":"...","items":[{"key":"要求原文或短键","label":"要求","ok":true,"reason":"..."}]}',
      image: sheet,
      modelKey,
      json: true,
      maxTokens: 1800,
      signal: input.signal,
    })
    const raw = r.json && typeof r.json === 'object' ? (r.json as Record<string, unknown>) : {}
    const items = normalizeItems(raw, input.requirements)
    const passed = items.length > 0 && items.every((x) => x.ok)
    return {
      passed,
      usedVision: true,
      modelKey: r.modelKey || modelKey,
      items,
      ...(raw.summary ? { summary: String(raw.summary).slice(0, 500) } : {}),
    }
  } catch (e) {
    return {
      passed: false,
      usedVision: false,
      needsHumanReview: true,
      items: input.requirements.map((label, i) => ({
        key: `req-${i}`,
        label,
        ok: false,
        reason: `视觉验收失败：${(e as Error).message}`,
      })),
      summary: `视觉验收失败，需要人工检查：${(e as Error).message}`,
    }
  }
}
