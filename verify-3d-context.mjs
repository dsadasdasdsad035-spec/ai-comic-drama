/**
 * 参考内容目录/默认选择/逐句台词/缺失项纯函数回归。
 * 跑法：node verify-3d-context.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-3d-context-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(root, 'src/shot3dContextCatalog.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(root, 'src/shot3dContext.ts'))}\n`,
)
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

const project = {
  episodes: [{ no: 1, scenes: [{ no: 2, slug: '井道', place: '地下泵房', time: '深夜', characters: ['陈默'] }] }],
  designs: [
    { id: 'scene-1', kind: 'scene', name: '井道', refs: [], summaryCn: '潮湿的混凝土井道', promptEn: 'wet shaft', keywords: [], image: '/project-assets/a/scene.png' },
    { id: 'prop-1', kind: 'prop', name: '铁箱', refs: ['S01'], summaryCn: '锈铁箱', promptEn: 'rusty box', keywords: [], image: '/project-assets/a/box.png' },
  ],
  assets: [
    { kind: 'image', title: '铁箱素材', url: '/project-assets/a/box.png', designId: 'prop-1' },
    { kind: 'image', title: '手动参考', url: '/generated/manual.png' },
  ],
}
const characters = [
  { id: 'chenmo', name: '陈默', role: '主角', lookCn: '', lookEn: '', palette: '', keywords: [], image: '/project-assets/a/chenmo.png' },
  { id: 'crow', name: '鸦', role: '引路人', lookCn: '', lookEn: '', palette: '', keywords: [], image: '/project-assets/a/crow.png' },
]
const shot = {
  no: 'S01',
  episode: 1,
  sceneNo: 2,
  sceneSlug: '井道',
  seconds: 3,
  size: '中景',
  move: '推',
  cast: ['陈默'],
  dialogue: '陈默：别动\n鸦：你听见了吗',
  prompt: '陈默站在井道门口',
  videoPrompt: '缓慢推近',
  marks: [{ id: 'm1', kind: 'rect', color: '#f00', x: 0.1, y: 0.2, w: 0.2, h: 0.2 }],
  refImage: '/generated/s01.png',
  candidates: ['/generated/s01.png', '/generated/s01b.png'],
  refIds: [],
  refExtras: [],
}
const media = {
  images: [
    { name: 's01.png', url: '/generated/s01.png', size: 1, mtime: 1 },
    { name: 'other.png', url: '/generated/other.png', size: 1, mtime: 1 },
  ],
  videos: [{ name: 'ref.mp4', url: '/videos/ref.mp4', size: 1, mtime: 1 }],
  assets: [],
}

const catalog = lib.buildShot3DContextCatalog({ project, characters, shot, media, sceneSlug: '井道', sceneNo: 2 })
check('角色分类完整', catalog.characters.length === 2, String(catalog.characters.length))
check('场景含设定卡和场次', catalog.scenes.some((x) => x.kind === 'scene-text') && catalog.scenes.some((x) => x.kind === 'scene'))
check('道具分类', catalog.props.length === 1)
check('项目素材去重（设定卡图不重复）', catalog.assets.length === 1, JSON.stringify(catalog.assets.map((x) => x.label)))
check('图片 URL 去重且当前帧优先', catalog.images[0]?.url === '/generated/s01.png' && catalog.images.filter((x) => x.url === '/generated/s01.png').length === 1, JSON.stringify(catalog.images.map((x) => x.url)))
check('视频分类', catalog.videos.length === 1)
check('台词逐句目录', catalog.text.dialogue.length === 2 && catalog.text.dialogue[1].speaker === '鸦')
check('默认角色来自 cast', JSON.stringify(catalog.defaults.characterIds) === JSON.stringify(['chenmo']), JSON.stringify(catalog.defaults.characterIds))
check('默认绑定场景/道具设定', catalog.defaults.designIds.includes('scene-1') && catalog.defaults.designIds.includes('prop-1'), JSON.stringify(catalog.defaults.designIds))
check('默认场次键不重复前缀', catalog.defaults.sceneKeys[0] === 'E01-SC02', JSON.stringify(catalog.defaults.sceneKeys))
check('默认文本全开', catalog.defaults.text.prompt && catalog.defaults.text.dialogue === 'all')
check('默认图片含首帧', catalog.defaults.imageUrls.includes('/generated/s01.png'))

const onlySecond = lib.toggleDialogueLine(catalog.defaults, 0, 2)
check('取消第一句后剩余第二句', JSON.stringify(onlySecond.text.dialogue) === JSON.stringify([1]), JSON.stringify(onlySecond.text.dialogue))
const selected = lib.toggleContextItem(catalog.defaults, catalog.videos[0])
check('视频可加入选择', selected.videoUrls.includes('/videos/ref.mp4'))
const removed = lib.toggleContextItem(selected, catalog.videos[0])
check('视频可移除', removed.videoUrls.length === 0)
const missing = lib.missingSelectionItems(catalog, { ...catalog.defaults, imageUrls: ['/generated/gone.png'], assetUrls: ['/generated/manual-gone.png'] })
check('缺失图片显示为缺失项', missing.some((x) => x.url === '/generated/gone.png' && x.missing))
check('缺失素材可移除', missing.some((x) => x.url === '/generated/manual-gone.png'))

const limited = { ...catalog.defaults, imageUrls: Array.from({ length: 16 }, (_, i) => `/generated/x${i}.png`) }
check('图片计数覆盖角色/设定卡/图片', lib.selectedImageCount(limited, catalog) >= 16, String(lib.selectedImageCount(limited, catalog)))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
