/**
 * 本地上传校验与保存的回归：
 * 1) 类型白名单（含 HEIC/GIF 拒绝、空 MIME 按扩展名兜底）
 * 2) 30MB 字节上限与 base64 膨胀后的请求体上限
 * 3) uploadImageFile：无项目拒绝、校验失败不上传、成功返回站内路径
 * 4) dataURL 前缀必须是服务端保存接口认的三种 MIME
 *
 * 用仓库已有的 esbuild 把 TS 打成临时 ESM；不新增测试框架、不碰网络。
 * 跑法：node verify-media-upload.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-media-upload-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [
    entry,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--log-level=error',
    `--outfile=${out}`,
  ])
  return out
}

const U = await import(bundle('src/mediaUpload.ts', 'mediaUpload'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

// ---------------------------------------------------------------- MIME 归一化

check('png 通过', U.imageMimeOf({ name: 'a.png', type: 'image/png' }) === 'image/png')
check('jpeg 通过', U.imageMimeOf({ name: 'a.jpg', type: 'image/jpeg' }) === 'image/jpeg')
check('image/jpg 归一成 image/jpeg', U.imageMimeOf({ name: 'a.jpg', type: 'image/jpg' }) === 'image/jpeg')
check('webp 通过', U.imageMimeOf({ name: 'a.webp', type: 'image/webp' }) === 'image/webp')
check(
  '空 MIME 按扩展名兜底',
  U.imageMimeOf({ name: 'IMG_0001.JPEG', type: '' }) === 'image/jpeg',
  JSON.stringify(U.imageMimeOf({ name: 'IMG_0001.JPEG', type: '' })),
)
check('heic 认不出', U.imageMimeOf({ name: 'a.heic', type: 'image/heic' }) === '')
check('gif 认不出', U.imageMimeOf({ name: 'a.gif', type: 'image/gif' }) === '')

// ---------------------------------------------------------------- 类型拒绝

const heic = U.pickImageFile({ name: 'IMG_0001.HEIC', size: 1000, type: 'image/heic' })
check('HEIC 被拒', heic.ok === false, heic.reason)
check('HEIC 文案点名格式', /png \/ jpeg \/ webp/.test(heic.reason || ''), heic.reason)
check('HEIC 文案给出导出建议', /HEIC|GIF/.test(heic.reason || ''), heic.reason)

const gif = U.pickImageFile({ name: 'a.gif', size: 1000, type: 'image/gif' })
check('GIF 被拒', gif.ok === false, gif.reason)

check('无文件被拒', U.pickImageFile(null).ok === false)
check('空文件被拒', U.pickImageFile({ name: 'a.png', size: 0, type: 'image/png' }).ok === false)

// ---------------------------------------------------------------- 大小上限

const over31 = U.pickImageFile({ name: 'big.png', size: 31 * 1024 * 1024, type: 'image/png' })
check('31MB 被拒', over31.ok === false, over31.reason)
check('31MB 文案带当前大小', /31\.0MB/.test(over31.reason || ''), over31.reason)

const ok28 = U.pickImageFile({ name: 'ok.png', size: 28 * 1024 * 1024, type: 'image/png' })
check('28MB 通过校验', ok28.ok === true, JSON.stringify(ok28))

// 30MB 正好等于服务端字节上限，但 base64 后约 40MB 会顶到请求体上限 → 必须提前拒
const at30 = U.pickImageFile({ name: 'edge.png', size: 30 * 1024 * 1024, type: 'image/png' })
check('刚好 30MB 因编码膨胀被拒', at30.ok === false, at30.reason)
check('膨胀拒绝文案说明编码后大小', /编码后/.test(at30.reason || ''), at30.reason)
check('encodedBodyBytes 1MB ≈ 1.33MB', U.encodedBodyBytes(1024 * 1024) === 1398104)

// ---------------------------------------------------------------- 常量与服务端一致

check('MAX_IMAGE_BYTES 与 server/media.mjs 的 30MB 一致', U.MAX_IMAGE_BYTES === 30 * 1024 * 1024)
check('MAX_REQUEST_BYTES 与 /api 的 40MB 一致', U.MAX_REQUEST_BYTES === 40 * 1024 * 1024)
check('ACCEPT_ATTR 只含三种格式', U.ACCEPT_ATTR === 'image/png,image/jpeg,image/webp', U.ACCEPT_ATTR)

// ---------------------------------------------------------------- 上传路径

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const pngFile = new File([pngBytes], 'probe.png', { type: 'image/png' })

const calls = []
const fakeSave = async (dataUrl, opts) => {
  calls.push({ dataUrl, opts })
  return '/project-assets/demo/probe.png'
}

const url = await U.uploadImageFile(pngFile, { project: 'demo', prefix: 'design' }, { save: fakeSave })
check('上传成功返回站内路径', url === '/project-assets/demo/probe.png', url)
check('只调用一次保存', calls.length === 1, String(calls.length))
check('dataURL 前缀是服务端认的 png', calls[0]?.dataUrl?.startsWith('data:image/png;base64,'))
check('保存时带项目名', calls[0]?.opts?.project === 'demo', JSON.stringify(calls[0]?.opts))
check('保存时带 prefix', calls[0]?.opts?.prefix === 'design', JSON.stringify(calls[0]?.opts))
check('dataURL 内容可还原', Buffer.from(calls[0].dataUrl.split(',')[1], 'base64').equals(pngBytes))

let noProject = ''
try {
  await U.uploadImageFile(pngFile, { project: '' }, { save: fakeSave })
} catch (e) {
  noProject = e.message
}
check('没有项目时拒绝', /选择项目/.test(noProject), noProject)

const beforeBad = calls.length
let rejected = ''
try {
  await U.uploadImageFile(new File([Buffer.from('x')], 'a.heic', { type: 'image/heic' }), { project: 'demo' }, { save: fakeSave })
} catch (e) {
  rejected = e.message
}
check('类型不合法时不发起保存', calls.length === beforeBad, `保存调用 ${calls.length}`)
check('类型不合法时抛可读原因', /png \/ jpeg \/ webp/.test(rejected), rejected)

let emptyUrl = ''
try {
  await U.uploadImageFile(pngFile, { project: 'demo' }, { save: async () => '' })
} catch (e) {
  emptyUrl = e.message
}
check('保存返回空地址时报错', /没有返回地址/.test(emptyUrl), emptyUrl)

// ---------------------------------------------------------------- 上传图参与分镜参考
// 上传把图落成 /project-assets/... 并由素材卡承载；这里直接验证参考解析器把它当图片参考。
const R = await import(bundle('src/shotReferences.ts', 'shotReferences'))

const uploadedUrl = '/project-assets/demo/asset-upload-1700000000000-abc123.png'
const shotNode = {
  id: 'shot-1',
  type: 'shot',
  position: { x: 0, y: 0 },
  data: {
    no: 'S01',
    seconds: 3,
    size: '中景',
    move: '固定',
    dialogue: '',
    prompt: '',
    marks: [],
    refIds: ['asset-uploaded'],
  },
}
const assetNode = {
  id: 'asset-uploaded',
  type: 'asset',
  position: { x: 0, y: 0 },
  data: { title: '上传的场景', kind: 'scene', url: uploadedUrl },
}

const collected = R.collectShotReferences({ node: shotNode, nodes: [shotNode, assetNode], characters: [] })
check(
  '上传素材卡进入参考集合',
  collected.refs.some((r) => r.url === uploadedUrl),
  JSON.stringify(collected.refs.map((r) => r.url)),
)
check('上传素材卡标记为 asset 来源', collected.refs.find((r) => r.url === uploadedUrl)?.source === 'asset')
check('上传素材卡带可读标签', /上传的场景/.test(collected.refs.find((r) => r.url === uploadedUrl)?.label || ''))

const limited = R.limitReferences(collected.refs, 4)
check('上传素材卡占用既有的 4 张预算', limited.used.length === 1 && limited.omitted.length === 0)

// 音频素材不参与画面参考（上传图片不该把 audio 类型带进来）
const audioNode = {
  id: 'asset-audio',
  type: 'asset',
  position: { x: 0, y: 0 },
  data: { title: '环境音', kind: 'audio', url: '/project-assets/demo/env.mp3' },
}
const audioShot = { ...shotNode, data: { ...shotNode.data, refIds: ['asset-audio'] } }
const audioRefs = R.collectShotReferences({ node: audioShot, nodes: [audioShot, audioNode], characters: [] })
check('音频素材不进画面参考', audioRefs.refs.length === 0, JSON.stringify(audioRefs.refs))

fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)