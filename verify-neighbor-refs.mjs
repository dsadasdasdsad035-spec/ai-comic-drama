/**
 * 相邻分镜参考纯函数回归：同集排序、prev/next、当前画面、关系 token、优先级/上限。
 * 跑法：node verify-neighbor-refs.mjs
 * UI/请求部分随后追加（需要 dev server）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-neighbor-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shotReferences.ts'))}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const lib = await import(bundle)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const shot = (id, no, image, extra = {}) => ({
  id,
  type: 'shot',
  data: {
    no, episode: 1, shotId: `E01-${no}`, refImage: image, candidates: [], activeIdx: 0,
    dialogue: '', prompt: '', marks: [], ...extra,
  },
})
const S01 = shot('n1', 'S01', '/img/s01.jpg')
const S02 = shot('n2', 'S02', '/img/s02.jpg')
const S03 = shot('n3', 'S03', '/img/s03.jpg')
const S04 = shot('n4', 'S04', '/img/s04.jpg')
const S10 = shot('n10', 'S10', '/img/s10.jpg')
const EP2 = shot('n-ep2', 'S01', '/img/ep2.jpg', { episode: 2 })
const nodes = [S01, S02, S03, S04, S10, EP2]

check('上一镜/下一镜', lib.neighborShots(S02, nodes).prev?.id === 'n1' && lib.neighborShots(S02, nodes).next?.id === 'n3')
check('非相邻不出现', !lib.neighborCandidates(S02, nodes).some((x) => x.no === 'S04'))
check('首镜没有上一镜', !lib.neighborShots(S01, nodes).prev)
check('末镜没有下一镜', !lib.neighborShots(S10, nodes).next)
check('镜号按数值排序 S2 -> S10', lib.neighborShots(S02, [S01, S02, S10]).next?.id === 'n10')
check('不跨集', lib.neighborShots(EP2, nodes).prev?.id !== 'n10' || lib.neighborShots(EP2, nodes).prev === undefined)
check('候选标签', lib.neighborCandidates(S02, nodes).map((x) => x.label).join('|') === '上一镜 S01|下一镜 S03')
check('无图下一镜仍返回并置灰', lib.neighborCandidates(S03, [S01, S02, S03, shot('n5', 'S04', '')])[1]?.hasImage === false)
check('当前候选回退', lib.currentShotImage({ candidates: ['/img/a.jpg', '/img/b.jpg'], activeIdx: 1 }) === '/img/b.jpg')
check('无图返回 undefined', lib.currentShotImage({ candidates: [] }) === undefined)
check('不自引用', !lib.neighborCandidates(S02, nodes).some((x) => x.no === 'S02'))
check('关系 token 存在检测', lib.hasNeighborReference(['shot-prev']) && !lib.hasNeighborReference(['shot-prev-x']))

const characters = [
  { id: 'chenmo', name: '陈默', image: '/img/char.jpg', role: '', lookCn: '', lookEn: '', palette: '', keywords: [] },
]
const asset = {
  id: 'asset-a', type: 'asset',
  data: { title: '井道', kind: 'scene', url: '/img/scene.jpg' },
}
const extra = '/img/extra.jpg'
const target = shot('n2', 'S02', '/img/s02.jpg', {
  refIds: ['char-chenmo', 'shot-prev', 'asset-a', 'shot-next'],
  refExtras: [extra],
  cast: ['陈默'],
})
const col = lib.collectShotReferences({ node: target, nodes: [...nodes, asset], characters })
check('角色 → 相邻 → 素材 → 手工顺序', col.refs.map((x) => x.source).join(',') === 'character,adjacent,adjacent,asset,extra', col.refs.map((x) => x.source).join(','))
check('相邻标签明确', col.refs.some((x) => x.label === '上一镜 S01画面'))
check('去重 URL', new Set(col.refs.map((x) => x.url)).size === col.refs.length)
check('缺失相邻有原因', lib.collectShotReferences({
  node: shot('n2', 'S02', '/img/s02.jpg', { refIds: ['shot-next'] }),
  nodes: [S01, S02, shot('n3', 'S03', '')],
  characters: [],
}).missing.some((x) => x.token === 'shot-next'))
check('缺失文件有原因', lib.collectShotReferences({
  node: shot('n2', 'S02', '/img/s02.jpg', { refIds: ['shot-prev'] }),
  nodes,
  characters: [],
  missingMedia: new Set(['/img/s01.jpg']),
}).missing.some((x) => x.token === 'shot-prev'))
check('取消相邻 token 后不再解析', lib.collectShotReferences({
  node: shot('n2', 'S02', '/img/s02.jpg', { refIds: [] }),
  nodes,
  characters,
}).refs.length === 0)
const reordered = [S01, S02, { ...S03, data: { ...S03.data, no: 'S00' } }, S04]
check('镜头重排后 token 解析新相邻', lib.neighborCandidates(S02, reordered).find((x) => x.token === 'shot-next')?.no === 'S04')
const limited = lib.limitReferences(col.refs, 4)
check('4 张上限有 omitted', limited.used.length === 4 && limited.omitted.length === 1)
check('10 张上限不误伤', lib.limitReferences(col.refs, 10).omitted.length === 0)
check('菜单无图项 disabled', lib.neighborReferenceItems(S03, [S01, S02, S03, shot('n5', 'S04', '')]).find((x) => x.id === 'shot-next')?.disabled === true)
check('resolveNeighborToken', lib.resolveNeighborToken(S02, nodes, 'shot-prev')?.no === 'S01')

fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
