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
  ],
  imageShotsToAssetCards: true,
})

const p = readProject(root, name)
check('读回迁移标记', p.imageShotsToAssetCards === true, String(p.imageShotsToAssetCards))
check('assets 两条', p.assets?.length === 2, String(p.assets?.length))
const rich = p.assets?.find((a) => a.canvasId === 'canvas-1')
check('prompt 往返', rich?.prompt === '雨夜霓虹', rich?.prompt)
check('refIds 往返', rich?.refIds?.length === 2 && rich.refIds[0] === 'char-hero', JSON.stringify(rich?.refIds))
const plain = p.assets?.find((a) => a.canvasId === 'canvas-2')
check('无 extra 的旧素材 prompt 为空', !plain?.prompt, String(plain?.prompt))
check('无 extra 的旧素材 refIds 缺省', !plain?.refIds?.length, JSON.stringify(plain?.refIds))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)