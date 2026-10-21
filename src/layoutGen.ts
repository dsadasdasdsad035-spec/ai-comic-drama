import { callText } from './api'
import { DEFAULT_LAYOUT, type ShotData, type ShotLayout } from './types'

/**
 * 让模型把「谁站哪、机位在哪」落成坐标。
 * 失败也不留白：回落到按出场人数左右排开的默认布局，用户可直接拖。
 */
export function fallbackLayout(cast: string[]): ShotLayout {
  const names = (cast ?? []).filter(Boolean).slice(0, 4)
  const gap = names.length > 1 ? 0.6 / (names.length - 1) : 0
  return {
    ...DEFAULT_LAYOUT,
    actors: names.map((name, i) => ({
      name,
      x: names.length === 1 ? 0.5 : 0.2 + gap * i,
      y: 0.45,
      face: i % 2 === 0 ? 0 : 180,
    })),
    camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.45 },
  }
}

const clamp01 = (v: unknown, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d
}

export async function generateLayout(
  d: ShotData,
  cast?: string[],
  modelKey?: string,
): Promise<ShotLayout> {
  const r = await callText<{ actors?: unknown; camera?: any; w?: number; h?: number }>({
    system: '你是场记兼分镜调度师。把一镜的画面拆成俯视平面上的站位与机位坐标，用于检查轴线与遮挡。',
    modelKey: modelKey || undefined,
    json: true,
    maxTokens: 1200,
    prompt:
      `画面：${d.prompt || '（无描述）'}\n` +
      `出场：${(cast ?? d.cast ?? []).join('、') || '（未标注）'}\n` +
      `景别 ${d.size}，运镜 ${d.move}。\n\n` +
      '输出 JSON：{"w":10,"h":8,"actors":[{"name":"角色名","x":0.2,"y":0.5,"face":0}],' +
      '"camera":{"x":0.5,"y":0.9,"lookX":0.5,"lookY":0.45}}\n' +
      'x 从左到右、y 从上到下，都归一化 0~1；face 是朝向角度（0=向右，90=向下，180=向左）。' +
      '机位放在轴线同侧，距离要能容纳该景别。',
  })

  const j = r.json as { actors?: any[]; camera?: any; w?: number; h?: number } | undefined
  const actors = Array.isArray(j?.actors)
    ? j!.actors
        .filter((a) => a && String(a.name || '').trim())
        .map((a) => ({
          name: String(a.name).trim(),
          x: clamp01(a.x, 0.5),
          y: clamp01(a.y, 0.5),
          face: Number(a.face) || 0,
        }))
    : []
  if (actors.length === 0) throw new Error('模型没给出站位')

  const cam = j?.camera ?? {}
  return {
    actors,
    camera: {
      x: clamp01(cam.x, 0.5),
      y: clamp01(cam.y, 0.9),
      lookX: clamp01(cam.lookX, 0.5),
      lookY: clamp01(cam.lookY, 0.5),
    },
    w: Number(j?.w) || 10,
    h: Number(j?.h) || 8,
  }
}

/** 方位名（用于文案）：以场地中心为原点，屏幕上北下南 */
function bearing(dx: number, dz: number): string {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI
  const names = ['正北', '东北', '正东', '东南', '正南', '西南', '正西', '西北']
  const idx = Math.round(((deg + 360) % 360) / 45) % 8
  return names[idx]
}

/**
 * 从调度坐标推出一句「可见物理量」的运镜/走位描述。
 *
 * 为什么不把 3D 白模视频直接喂给生成模型：它会被当成首帧/参考图，把画面带成几何体风格。
 * 真正能约束生成模型的是文字（英文运镜词汇 + 米数），所以这里把调度翻译成文案。
 */
export function motionNoteOf(l: ShotLayout): string {
  const w = l.w ?? 10
  const h = l.h ?? 8
  const cx = l.camera.x - 0.5
  const cz = l.camera.y - 0.5
  const distX = Math.abs(cx) * w
  const distZ = Math.abs(cz) * h
  const dist = Math.sqrt(distX * distX + distZ * distZ)
  const camWhere = `机位在场地${bearing(cx, cz)}侧、距场地中心约 ${dist.toFixed(1)} 米、高 1.6 米`

  const lx = l.camera.lookX - 0.5
  const lz = l.camera.lookY - 0.5
  const lookDir = bearing(lx - cx, lz - cz)

  const actors = (l.actors ?? []).slice(0, 4).map((a) => {
    const ax = (a.x - 0.5) * w
    const az = (a.y - 0.5) * h
    const toCam = bearing(l.camera.x - a.x, l.camera.y - a.y)
    const facing = bearing(Math.cos(((a.face ?? 0) * Math.PI) / 180), Math.sin(((a.face ?? 0) * Math.PI) / 180))
    const r = Math.sqrt((a.x - l.camera.x) ** 2 + (a.y - l.camera.y) ** 2)
    return `${a.name}位于场地${bearing(ax, az)}侧、距机位约 ${(r * Math.max(w, h)).toFixed(1)} 米，面朝${facing}（机位在其${toCam}方向）`
  })

  const a0 = l.actors?.[0]
  const a1 = l.actors?.[1]
  const axisNote =
    a0 && a1
      ? `轴线为${a0.name}—${a1.name}连线，机位在轴线${(l.camera.y < (a0.y + a1.y) / 2 ? '近侧' : '远侧')}`
      : ''

  return [
    camWhere,
    `镜头朝向场地${lookDir}，缓慢前推约 0.6 米、机位高度基本不变`,
    ...actors,
    axisNote,
  ]
    .filter(Boolean)
    .join('；')
}
