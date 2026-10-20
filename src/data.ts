import type { Edge, Node } from '@xyflow/react'
import type { Relation, ShotData } from './types'

export type ShotNodeType = Node<ShotData, 'shot'>
export type ShotEdgeType = Edge<{ relation: Relation }, 'shot'>

/** 用纯 SVG 生成一张「参考图占位」，避免依赖外网图片 */
function refArt(a: string, b: string, seed: number) {
  const bars: string[] = []
  for (let i = 0; i < 14; i++) {
    const w = 9 + ((i * 37 + seed * 13) % 22)
    const h = 22 + ((i * 53 + seed * 7) % 86)
    bars.push(
      `<rect x="${i * 24}" y="${180 - h}" width="${w}" height="${h}" fill="rgba(3,10,18,.62)"/>`,
    )
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">` +
    `<defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
    `<radialGradient id="r"><stop offset="0" stop-color="rgba(255,255,255,.42)"/>` +
    `<stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>` +
    `</defs>` +
    `<rect width="320" height="180" fill="url(#g)"/>` +
    `<circle cx="${70 + seed * 26}" cy="62" r="78" fill="url(#r)"/>` +
    bars.join('') +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const shot = (
  no: string,
  x: number,
  y: number,
  seconds: number,
  size: string,
  move: string,
  dialogue: string,
  prompt: string,
  art: string,
): ShotNodeType => ({
  id: no,
  type: 'shot',
  position: { x, y },
  data: { no, seconds, size, move, dialogue, prompt, refImage: art, marks: [] },
})

export const initialNodes: ShotNodeType[] = [
  shot(
    'S01', 0, 0, 3.0, '远景', '固定',
    '',
    '近未来废土城市天际线，巨型广告牌残骸，橙紫色暮光，空气中悬浮尘埃，电影感广角',
    refArt('#f59e0b', '#7c2d12', 1),
  ),
  shot(
    'S02', 340, 96, 4.5, '全景', '跟',
    '（环境音）',
    '回收人推着满载义体的推车穿过夜市，霓虹灯牌反光，人群剪影，低机位跟拍',
    refArt('#0ea5e9', '#1e1b4b', 2),
  ),
  shot(
    'S03', 680, 0, 3.2, '中景', '推',
    '摊主：这个月就这一只，成色你还挑？',
    '摊主把一只义体手臂推过桌面，金属反光，暖色顶光，浅景深',
    refArt('#f97316', '#450a0a', 3),
  ),
  shot(
    'S04', 1020, 96, 2.8, '近景', '固定',
    '',
    '回收人低头端详义体，手指擦过序列号，眼神微动，侧逆光勾勒轮廓',
    refArt('#22d3ee', '#0f172a', 4),
  ),
  shot(
    'S05', 1360, 0, 2.0, '大特写', '摇',
    '回收人（气声）：……是她的。',
    '义体关节内侧的序列号特写，锈迹与划痕，镜头缓慢下摇，冷蓝光',
    refArt('#a78bfa', '#111827', 5),
  ),
]

export const initialEdges: ShotEdgeType[] = [
  { id: 'e1', source: 'S01', target: 'S02', type: 'shot', data: { relation: 'cut' } },
  { id: 'e2', source: 'S02', target: 'S03', type: 'shot', data: { relation: 'cut' } },
  { id: 'e3', source: 'S03', target: 'S04', type: 'shot', data: { relation: 'transition' } },
  { id: 'e4', source: 'S04', target: 'S05', type: 'shot', data: { relation: 'flashback' } },
]
