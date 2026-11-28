/**
 * assets.extra / projects.extra：prompt、refIds、imageShotsToAssetCards 往返
 * 跑法：node verify-asset-card-extra.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, readProject, writeProject } from './server/db.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-asset-card-extra-'))
openDatabase(root)
const name = 'extra-demo'

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

writeProject(root, name, {
  name,
  shots: [],
  characters: [],
  assets: [
    {
      kind: 'image',
      title: '提示词卡',
      url: '/generated/a.jpg',
      canvasId: 'canvas-1',
      prompt: '雨夜霓虹',
      refIds: ['char-hero', 'asset-ref'],
    },
    {
      kind: 'prop',
      title: '旧行',
      url: '',
      canvasId: 'canvas-2',
      note: '无 extra',
    },
    {
      kind: 'subtitle',
      title: '字幕卡',
      url: '',
      canvasId: 'canvas-sub',
      sourceShotIds: ['shot-1'],
      promptSource: 'dialogue',
      srtBody: `1\n00:00:00,000 --> 00:00:02,000\n台词\n`,
    },
  ],
  imageShotsToAssetCards: true,
})

const p = readProject(root, name)
check('读回迁移标记', p.imageShotsToAssetCards === true, String(p.imageShotsToAssetCards))
check('assets 三条', p.assets?.length === 3, String(p.assets?.length))
const rich = p.assets?.find((a) => a.canvasId === 'canvas-1')
check('prompt 往返', rich?.prompt === '雨夜霓虹', rich?.prompt)
check('refIds 往返', rich?.refIds?.length === 2 && rich.refIds[0] === 'char-hero', JSON.stringify(rich?.refIds))
const plain = p.assets?.find((a) => a.canvasId === 'canvas-2')
check('无 extra 的旧素材 prompt 为空', !plain?.prompt, String(plain?.prompt))
check('无 extra 的旧素材 refIds 缺省', !plain?.refIds?.length, JSON.stringify(plain?.refIds))
const sub = p.assets?.find((a) => a.canvasId === 'canvas-sub')
check('subtitle kind', sub?.kind === 'subtitle', sub?.kind)
check('sourceShotIds 往返', sub?.sourceShotIds?.[0] === 'shot-1', JSON.stringify(sub?.sourceShotIds))
check('srtBody 往返', String(sub?.srtBody || '').includes('台词'), String(sub?.srtBody).slice(0, 60))

// 遗留 cues 迁移
writeProject(root, name + '-mig', {
  assets: [
    {
      kind: 'subtitle',
      title: '旧字幕',
      url: '',
      canvasId: 'canvas-legacy',
      cues: [{ id: 'c1', text: '迁移', startMs: 0, endMs: 1500 }],
    },
  ],
})
const legacy = readProject(root, name + '-mig')?.assets?.find((a) => a.canvasId === 'canvas-legacy')
check('遗留 cues → srtBody', String(legacy?.srtBody || '').includes('迁移'), legacy?.srtBody)

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)