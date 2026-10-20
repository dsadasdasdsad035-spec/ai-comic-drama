export type GenResult = {
  urls: string[]
  url: string
  size: string
  elapsed: number
}

export type GenError = { message: string; kind?: string }

/** 调用本地代理 → 火山方舟 Seedream，图存到 public/generated 并返回站内路径 */
export async function generateImage(opts: {
  prompt: string
  ratio: string
  refImage?: string
  n?: number
}): Promise<GenResult> {
  let res: Response
  try {
    res = await fetch('/api/seedream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }

  let j: any
  try {
    j = await res.json()
  } catch {
    throw new Error(`代理返回了非 JSON 响应（HTTP ${res.status}）`)
  }

  if (!j.ok) {
    const hint =
      j.kind === 'billing'
        ? '（火山方舟账户可能欠费或余额不足）'
        : j.kind === 'no-key'
          ? ''
          : j.kind === 'auth'
            ? '（密钥无效）'
            : ''
    throw new Error(`${j.message}${hint}`)
  }
  const urls: string[] = Array.isArray(j.urls) ? j.urls : [j.url]
  return { ...(j as GenResult), urls }
}

export async function checkHealth(): Promise<{ hasKey: boolean; model: string } | null> {
  try {
    const r = await fetch('/api/health')
    return await r.json()
  } catch {
    return null
  }
}

// ---------- 图生视频 ----------

export type VideoOpts = {
  image: string
  prompt: string
  seconds: number
  ratio: string
  resolution?: '480p' | '720p'
  cameraFixed?: boolean
}

async function readJsonRes(res: Response) {
  try {
    return await res.json()
  } catch {
    throw new Error(`代理返回了非 JSON 响应（HTTP ${res.status}）`)
  }
}

/** 提交视频任务，返回任务 id（生成需要 1~4 分钟，不阻塞 HTTP） */
export async function startVideo(o: VideoOpts): Promise<string> {
  let res: Response
  try {
    res = await fetch('/api/seedance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '提交失败')
  return j.id as string
}

/** 轮询直到出片；onTick 每次回调可用于刷新计时 */
export async function waitVideo(
  id: string,
  onTick?: (elapsedSec: number) => void,
  timeoutMs = 12 * 60 * 1000,
): Promise<string> {
  const t0 = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000))
    let j: any
    try {
      const r = await fetch(`/api/seedance?id=${encodeURIComponent(id)}`)
      j = await readJsonRes(r)
    } catch (e) {
      throw new Error((e as Error).message)
    }
    if (!j.ok) throw new Error(j.message || '查询失败')
    if (j.status === 'succeeded') return j.url as string
    if (j.status === 'failed') throw new Error(j.message || '生成失败')
    onTick?.(Math.round((Date.now() - t0) / 1000))
    if (Date.now() - t0 > timeoutMs) throw new Error('等待超时，可稍后重试')
  }
}

// ---------- animatic 合成 ----------

export type ExportSegment = {
  seconds: number
  video?: string
  image?: string
  voice?: string
  /** 台词（服务端有 libass 时据此生成 SRT） */
  dialogue?: string
  /** 无 libass 时的兜底：整帧透明 PNG（dataURL） */
  sub?: string
}

export type ExportResult = {
  url: string
  shots: number
  seconds: number
  voiced: number
  subbed: number
  overflows: { shot: number; voice: number; shotLen: number }[]
  elapsed: number
}

/** 把分镜序列交给 ffmpeg 拼成一条 mp4（静帧与视频混编） */
export async function assembleAnimatic(
  segments: ExportSegment[],
  resolution: '480p' | '720p' | '1080p',
  timeoutMs = 10 * 60 * 1000,
): Promise<ExportResult> {
  let res: Response
  try {
    res = await fetch('/api/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, resolution }),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '提交合成失败')

  const t0 = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 1200))
    const r = await fetch(`/api/assemble?id=${encodeURIComponent(j.id)}`)
    const s = await readJsonRes(r)
    if (!s.ok) throw new Error(s.message || '查询合成状态失败')
    if (s.status === 'succeeded') {
      return {
        url: s.url,
        shots: s.shots,
        seconds: s.seconds,
        voiced: s.voiced ?? 0,
        subbed: s.subbed ?? 0,
        overflows: s.overflows ?? [],
        elapsed: s.elapsed,
      }
    }
    if (s.status === 'failed') throw new Error(s.message || '合成失败')
    if (Date.now() - t0 > timeoutMs) throw new Error('合成超时')
  }
}

// ---------- 台词配音 ----------

export type VoiceResult = { url: string; engine: string; seconds: number; elapsed: number }

export async function generateVoice(o: {
  text: string
  voice?: string
  rate?: number
}): Promise<VoiceResult> {
  let res: Response
  try {
    res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '配音失败')
  return j as VoiceResult
}

export type VoiceOption = { id: string; label: string }
export type VoiceList = { provider: string; voices: VoiceOption[] }

/** 列出当前 TTS provider 下真正可用的音色 */
export async function listVoices(): Promise<VoiceList> {
  try {
    const r = await fetch('/api/voices')
    const j = await readJsonRes(r)
    if (!j.ok) return { provider: 'none', voices: [] }
    return { provider: j.provider ?? 'unknown', voices: j.voices ?? [] }
  } catch {
    return { provider: 'none', voices: [] }
  }
}
