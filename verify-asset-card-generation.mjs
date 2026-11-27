/**
 * 素材卡出图/出音请求体与计数约束（纯函数，不调用上游）
 * 跑法：node verify-asset-card-generation.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-asset-card-gen-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/assetCardRefs.ts')}`,
    `export * from ${abs('src/shotReferences.ts')}`,
    `export * from ${abs('src/videoPrompt.ts')}`,
    `export { planAddShot } from ${abs('src/canvasShotOps.ts')}`,
    `export { audioModelReady } from ${abs('src/assetCardGeneration.ts')}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
const banner = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--banner:js=${banner}`,
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

// 3.1 新建镜头不增镜数以外逻辑：planAddShot 固定 video
{
  const before = [{ id: 'a', episode: 1, no: 'S01', prod_kind: 'video' }]
  const { shot, next } = lib.planAddShot(before, 1)
  check('新镜头 prod_kind 为 video', shot.prod_kind === 'video', shot.prod_kind)
  check('镜数 +1', next.length === 2, String(next.length))
}

// 3.2 图片素材卡参考解析
{
  const assetCard = {
    id: 'asset-c1',
    type: 'asset',
    position: { x: 0, y: 0 },
    data: { kind: 'image', title: '卡', prompt: '猫', refIds: ['char-x', 'asset-scene'] },
  }
  const nodes = [
    assetCard,
    { id: 'asset-scene', type: 'asset', position: { x: 0, y: 0 }, data: { kind: 'scene', url: '/s.png', title: '街景' } },
    { id: 'shot-n', type: 'shot', position: { x: 0, y: 0 }, data: { refIds: ['shot-prev'], refImage: '/n.jpg' } },
  ]
  const r = lib.collectAssetImageReferences({
    node: assetCard,
    nodes,
    characters: [{ id: 'x', name: '主角', image: '/c.png' }],
  })
  check('无邻镜参考', r.refs.every((x) => x.source !== 'adjacent'), JSON.stringify(r.refs))
  check('角色与场景素材进入', r.refs.length === 2, JSON.stringify(r.refs))
  const empty = lib.collectAssetImageReferences({
    node: { ...assetCard, data: { ...assetCard.data, refIds: [] } },
    nodes,
    characters: [],
  })
  check('无连线时参考为空', empty.refs.length === 0)
}

// 3.3 音频模型就绪
{
  const models = [
    { key: 'voice-a', caps: ['audio'], provider: 'x', model: 'm', runtime: 'live' },
  ]
  const ok = lib.audioModelReady('voice-a', models)
  check('已接入音频模型可提交', ok.ok === true)
  const no = lib.audioModelReady('missing', models)
  check('未接入模型拒绝', no.ok === false && no.reason.includes('无效'), no.reason)
}

// 3.4 出片镜引用图片卡 / 音频卡
{
  const shotNode = {
    id: 'shot-1',
    type: 'shot',
    position: { x: 0, y: 0 },
    data: {
      prodKind: 'video',
      video_prompt: '横移',
      refIds: ['asset-img', 'asset-aud'],
      seconds: 5,
    },
  }
  const nodes = [
    shotNode,
    { id: 'asset-img', type: 'asset', position: { x: 0, y: 0 }, data: { kind: 'image', url: '/g.png', title: '图' } },
    { id: 'asset-aud', type: 'asset', position: { x: 0, y: 0 }, data: { kind: 'audio', url: '/v.mp3', title: '音色' } },
  ]
  const imgs = lib.collectShotReferences({ node: shotNode, nodes, characters: [] })
  check('图片卡进入出片图片参考', imgs.refs.some((r) => r.url === '/g.png'), JSON.stringify(imgs.refs))
  const aud = lib.collectAudioReferences({ node: shotNode, nodes })
  check('音频卡进入音频参考', aud.refs.length === 1 && aud.refs[0].url === '/v.mp3', JSON.stringify(aud.refs))
  check('音频不进图片参考', !imgs.refs.some((r) => r.url === '/v.mp3'))
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)