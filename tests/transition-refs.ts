import assert from 'node:assert/strict'
import { transitionRefCandidateView } from '../src/transitionGen'
import { assetNodesFromAssets, composeShotCanvasNodes } from '../src/canvasShots'
import type { ShotNodeType } from '../src/data'
import type { CharacterSheet } from '../src/characters'

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

const shots = [
  {
    id: 'E01-S01',
    episode: 1,
    no: 'S01',
    seconds: 3,
    refExtras: ['/generated/shared.jpg'],
    transition_out: { to: 'E01-S02', mode: 'generated', generated: {} },
  },
  {
    id: 'E01-S02',
    episode: 1,
    no: 'S02',
    seconds: 3,
    // 与上镜同址：候选池必须去重
    refExtras: ['/generated/shared.jpg'],
  },
]

const characters = [
  { id: '林小满', name: '林小满', image: '/generated/lin.png' },
  { id: '陈默', name: '陈默', image: '/generated/chen.png' },
  // 占位角色：没有外观图，不可作为转场参考
  { id: '路人甲', name: '路人甲' },
] as unknown as CharacterSheet[]

const assets = [
  { canvasId: 'cv-scene', url: '/generated/scene.png', title: '雨夜街口', kind: 'scene' },
  { canvasId: 'cv-video', url: '/generated/motion.mp4', title: '推镜', kind: 'video' },
  { canvasId: 'cv-audio', url: '/generated/bgm.mp3', title: '环境声', kind: 'audio' },
]

function nodesWithAssets(): ShotNodeType[] {
  return composeShotCanvasNodes(assetNodesFromAssets(assets as never), shots as never)
}

function view(generated: Record<string, unknown> = {}, missing: Set<string> = new Set()) {
  const nodes = nodesWithAssets()
  const source = nodes.find((n) => String(n.data?.shotId ?? '') === 'E01-S01')!
  const target = nodes.find((n) => String(n.data?.shotId ?? '') === 'E01-S02')!
  return transitionRefCandidateView({
    source,
    target,
    nodes,
    characters,
    missingMedia: missing,
    generated,
  })
}

async function main() {
  await check('候选池按 url 去重，两镜同址只出现一次', () => {
    const { candidates } = view()
    const shared = candidates.filter((c) => c.url === '/generated/shared.jpg')
    assert.equal(shared.length, 1)
  })

  await check('没有外观图的占位角色不入选', () => {
    const { candidates } = view()
    assert.equal(candidates.some((c) => c.label.includes('路人甲')), false)
    assert.equal(
      candidates.some((c) => c.token.includes('路人甲')),
      false,
    )
  })

  await check('视频与音频素材卡不入选，图片素材卡入选', () => {
    const { candidates } = view()
    assert.equal(candidates.some((c) => c.url === '/generated/motion.mp4'), false)
    assert.equal(candidates.some((c) => c.url === '/generated/bgm.mp3'), false)
    const scene = candidates.find((c) => c.url === '/generated/scene.png')
    assert.ok(scene, '场景图必须可作候选')
    assert.equal(scene.source, 'asset')
    assert.equal(scene.token, 'asset-cv-scene')
  })

  await check('全部候选在 refIds 为空时标未提交，摘要给出候选与已提交计数', () => {
    const { candidates, summary } = view({ refIds: [] })
    assert.ok(candidates.length >= 4, `候选应含两角色、两图素材与手工 URL，实际 ${candidates.length}`)
    assert.equal(candidates.every((c) => c.submitted === false), true)
    assert.equal(summary, `候选 ${candidates.length} 项、已提交 0 项`)
  })

  await check('refIds 里的 token 标为已提交，其余保持未提交', () => {
    const { candidates, summary } = view({ refIds: ['asset-cv-scene', 'char-林小满'] })
    assert.equal(candidates.filter((c) => c.submitted).length, 2)
    assert.equal(candidates.find((c) => c.token === 'asset-cv-scene')?.submitted, true)
    assert.equal(candidates.find((c) => c.token === 'char-林小满')?.submitted, true)
    assert.match(summary, /已提交 2 项/)
  })

  await check('占位角色的 refIds 不会被当成已提交', () => {
    const { candidates } = view({ refIds: ['char-miss-路人甲'] })
    assert.equal(candidates.some((c) => c.submitted), false)
  })

  await check('媒体缺失的候选带可读原因', () => {
    const { candidates } = view({}, new Set(['/generated/scene.png']))
    const scene = candidates.find((c) => c.url === '/generated/scene.png')
    assert.ok(scene?.reason, '缺失媒体必须带原因，不能静默不可用')
    assert.equal(candidates.find((c) => c.url === '/generated/lin.png')?.reason, undefined)
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
