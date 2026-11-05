/**
 * 在线素材库服务端验收：来源注册、检索归一化、缓存/令牌、导入下载校验、来源元数据。
 * 全部请求打本地 mock，不依赖真实外网。
 * 跑法：node verify-stock-api.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import {
  createProject,
  upsertStockImport,
  getStockImportByItem,
  findStockImportByUrl,
  listStockImports,
} from './server/db.mjs'
import {
  normalizeStockSettings,
  applyStockEnvDefaults,
  redactStockSettings,
  mergeStockSettings,
  resolveStockProvider,
} from './server/stock-settings.mjs'
import { saveProjectMedia, saveProjectMediaStream, projectMediaDir, projectMediaExists } from './server/media.mjs'
import {
  StockError,
  describeProviders,
  importStockItem,
  issueStockToken,
  pickVariant,
  providerAvailability,
  resetStockState,
  searchStock,
} from './server/stock.mjs'
import { assertPublicUrl } from './server/ingest.mjs'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-'))
const PROJECTS = path.join(TMP, 'projects')
fs.mkdirSync(PROJECTS, { recursive: true })
// 媒体模块会用 resolveRoot 再解析一次根目录；这里统一指向临时项目根
process.env.SB_PROJECTS_DIR = PROJECTS

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const section = (title) => console.log(`\n=== ${title} ===`)
/** 项目媒体目录还不存在时也算「没有残留文件」 */
const hasPartOrExt = (root, project, exts) => {
  const dir = projectMediaDir(root, project)
  if (!fs.existsSync(dir)) return false
  return fs.readdirSync(dir).some((f) => exts.some((e) => f.endsWith(e)))
}

// ---------------------------------------------------------------- 1. 来源记录

section('来源记录（stock_imports）')
createProject(PROJECTS, 'stock-a')
createProject(PROJECTS, 'stock-b')
createProject(PROJECTS, 'stock-reject')

const recA = upsertStockImport(PROJECTS, 'stock-a', {
  provider: 'pexels',
  itemId: '12345',
  url: '/project-assets/stock-a/stock-pexels-12345.jpg',
  mediaType: 'image',
  title: '雨夜街头',
  author: 'Ada',
  authorUrl: 'https://example.com/ada',
  sourceUrl: 'https://example.com/photo/12345',
  license: 'Pexels License',
  licenseUrl: 'https://www.pexels.com/license/',
  attribution: 'Photo by Ada on Pexels',
  width: 1920,
  height: 1080,
  bytes: 100,
})
check('写入后可读', recA?.provider === 'pexels' && recA?.itemId === '12345', JSON.stringify(recA))
check(
  '字段完整',
  recA?.author === 'Ada' &&
    recA?.license === 'Pexels License' &&
    recA?.width === 1920 &&
    recA?.bytes === 100 &&
    Boolean(recA?.createdAt),
)
const byItem = getStockImportByItem(PROJECTS, 'stock-a', 'pexels', '12345')
check('按条目可查', byItem?.title === '雨夜街头')
const byUrl = findStockImportByUrl(PROJECTS, 'stock-a', '/project-assets/stock-a/stock-pexels-12345.jpg')
check('按站内地址可查', byUrl?.itemId === '12345')
check('普通地址查不到', findStockImportByUrl(PROJECTS, 'stock-a', '/generated/none.jpg') === undefined)
check(
  '项目 B 看不到 A 的记录',
  findStockImportByUrl(PROJECTS, 'stock-b', '/project-assets/stock-a/stock-pexels-12345.jpg') === undefined &&
    getStockImportByItem(PROJECTS, 'stock-b', 'pexels', '12345') === undefined,
)

upsertStockImport(PROJECTS, 'stock-a', {
  provider: 'pexels',
  itemId: '12345',
  url: '/project-assets/stock-a/stock-pexels-12345.jpg',
  mediaType: 'image',
  title: '雨夜街头（改名）',
  author: 'Ada',
  license: 'Pexels License',
})
const upserted = listStockImports(PROJECTS, 'stock-a')
check(
  '同条目幂等更新而不是新增',
  upserted.length === 1 && upserted[0].title === '雨夜街头（改名）',
  `rows=${upserted.length}`,
)

upsertStockImport(PROJECTS, 'stock-a', {
  provider: 'openverse',
  itemId: 'audio-1',
  url: '/project-assets/stock-a/stock-openverse-audio-1.mp3',
  mediaType: 'audio',
  title: '环境雨声',
})
const both = listStockImports(PROJECTS, 'stock-a')
check('两个来源各留一条', both.length === 2 && both.some((x) => x.mediaType === 'audio'))

let threw = ''
try {
  upsertStockImport(PROJECTS, 'missing-project', { provider: 'pexels', itemId: '1' })
} catch (e) {
  threw = e.message
}
check('项目不存在时拒绝写入', /项目不存在/.test(threw), threw)

// ---------------------------------------------------------------- 2. 项目媒体落盘

section('项目媒体落盘')

const mediaSaved = saveProjectMedia(PROJECTS, 'stock-a', Buffer.from('fake-mp3-bytes'), {
  ext: 'mp3',
  prefix: 'stock',
  file: 'stock-openverse-audio-1.mp3',
})
check(
  '固定文件名落盘',
  mediaSaved.file === 'stock-openverse-audio-1.mp3' &&
    mediaSaved.url === '/project-assets/stock-a/stock-openverse-audio-1.mp3',
  JSON.stringify(mediaSaved),
)
check('文件确实存在', projectMediaExists(PROJECTS, 'stock-a', mediaSaved.file))
const noPart = fs.readdirSync(projectMediaDir(PROJECTS, 'stock-a')).filter((f) => f.endsWith('.part'))
check('没有残留 .part 文件', noPart.length === 0, noPart.join(','))

const streamBytes = (chunks) =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(Buffer.from(c)))
      controller.close()
    },
  })
const streamed = await saveProjectMediaStream(PROJECTS, 'stock-a', streamBytes(['a', 'bc']), {
  ext: 'wav',
  file: 'stock-stream-test.wav',
  maxBytes: 1024,
})
check('流式写入成功并计数', streamed.bytes === 3, JSON.stringify(streamed))

let overLimit = ''
try {
  await saveProjectMediaStream(PROJECTS, 'stock-a', streamBytes(['12345', '67890']), {
    ext: 'wav',
    file: 'stock-too-big.wav',
    maxBytes: 4,
  })
} catch (e) {
  overLimit = e.message
}
check('超限中止并报错', /大小上限/.test(overLimit), overLimit)
check(
  '超限后不留下文件',
  !projectMediaExists(PROJECTS, 'stock-a', 'stock-too-big.wav') &&
    !fs.readdirSync(projectMediaDir(PROJECTS, 'stock-a')).some((f) => f.startsWith('stock-too-big')),
)

// ---------------------------------------------------------------- 3. 来源与检索

section('来源注册与可用性')

const enabledSettings = {
  providers: {
    pexels: { enabled: true, apiKey: 'px', baseUrl: 'https://mock.example/pexels' },
    pixabay: { enabled: true, apiKey: 'pb', baseUrl: 'https://mock.example/pixabay' },
    openverse: { enabled: true, apiKey: '', baseUrl: 'https://mock.example/openverse' },
    unsplash: { enabled: true, apiKey: 'us', baseUrl: 'https://mock.example/unsplash' },
    coverr: { enabled: true, apiKey: 'cv', baseUrl: 'https://mock.example/coverr' },
    mixkit: { enabled: true, baseUrl: 'https://mock.example/mixkit' },
    // 显式关闭也不影响外链来源：它不产生请求
    vjshi: { enabled: false, baseUrl: 'https://mock.example/vjshi' },
  },
}
const providers = describeProviders(enabledSettings, {})
const providerIds = providers.map((p) => p.id).join(',')
check(
  '七个来源全部注册',
  providerIds === 'pexels,pixabay,openverse,unsplash,coverr,mixkit,vjshi',
  providerIds,
)
check('七个来源都可用', providers.every((p) => p.ok), providers.map((p) => `${p.id}:${p.reason || 'ok'}`).join(' / '))
check(
  '每个来源都声明 kind',
  providers.every((p) => ['api', 'html', 'link'].includes(p.kind)),
  providers.map((p) => `${p.id}:${p.kind}`).join(','),
)
check(
  '原有三个来源仍是 api',
  ['pexels', 'pixabay', 'openverse'].every((id) => providers.find((p) => p.id === id).kind === 'api'),
)
const linkProvider = providers.find((p) => p.id === 'vjshi')
check(
  '外链来源不可检索不可导入',
  linkProvider.searchable === false &&
    linkProvider.importable === false &&
    linkProvider.ok === true &&
    linkProvider.externalUrlTemplate === 'https://mock.example/vjshi/so?wd={query}',
  JSON.stringify(linkProvider),
)
const htmlProvider = providers.find((p) => p.id === 'mixkit')
check(
  '页面解析来源不要 Key 也可用',
  htmlProvider.ok === true && htmlProvider.requiresKey === false && htmlProvider.kind === 'html',
  JSON.stringify(htmlProvider),
)
check(
  '媒体类型声明正确',
  providers.find((p) => p.id === 'pexels').mediaTypes.join(',') === 'image,video' &&
    providers.find((p) => p.id === 'openverse').mediaTypes.join(',') === 'image,audio' &&
    providers.find((p) => p.id === 'unsplash').mediaTypes.join(',') === 'image' &&
    providers.find((p) => p.id === 'coverr').mediaTypes.join(',') === 'video' &&
    providers.find((p) => p.id === 'mixkit').mediaTypes.join(',') === 'video',
)
check(
  '可用性快照符合设计表',
  JSON.stringify(providers.map((p) => [p.id, p.ok, p.searchable])) ===
    JSON.stringify([
      ['pexels', true, true],
      ['pixabay', true, true],
      ['openverse', true, true],
      ['unsplash', true, true],
      ['coverr', true, true],
      ['mixkit', true, true],
      ['vjshi', true, false],
    ]),
  JSON.stringify(providers.map((p) => [p.id, p.ok, p.searchable])),
)
const disabled = describeProviders({}, {})
check(
  '需要 Key 的来源未启用时给原因',
  disabled.filter((p) => p.kind === 'api' && p.requiresKey).every((p) => !p.ok && /未启用/.test(p.reason)),
  disabled.map((p) => `${p.id}:${p.reason || 'ok'}`).join(' / '),
)
check(
  'html / link 型未配置也默认可用',
  disabled.find((p) => p.id === 'mixkit').ok === true && disabled.find((p) => p.id === 'vjshi').ok === true,
)
const noKeyProviders = describeProviders({ providers: { pexels: { enabled: true, apiKey: '' } } }, { PEXELS_API_KEY: '' })
check('缺 Key 来源不可用', noKeyProviders.find((p) => p.id === 'pexels').reason === '未配置 Key')
const ovAnon = describeProviders({ providers: { openverse: { enabled: true, apiKey: '' } } }, {})
check('Openverse 匿名可用', ovAnon.find((p) => p.id === 'openverse').ok === true)
check(
  '未知来源 availability 为 null',
  providerAvailability(enabledSettings, 'nope', {}) === null,
)

// 统一 mock：按 path 返回三家来源的响应，并记录请求次数与参数
let mockHits = 0
const mockSeen = []
const mockFetch = async (url, init = {}) => {
  mockHits++
  const u = new URL(String(url))
  mockSeen.push({ path: u.pathname, search: u.searchParams, headers: init.headers || {} })
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  if (u.pathname === '/pexels/v1/search') {
    return json({
      total_results: 2,
      next_page: 'https://mock.example/pexels/v1/search?page=2',
      photos: [
        {
          id: 11,
          width: 4000,
          height: 3000,
          url: 'https://www.pexels.com/photo/11/',
          photographer: 'Ada',
          photographer_url: 'https://www.pexels.com/@ada',
          alt: '雨夜霓虹街道',
          src: {
            original: 'https://cdn.example/11-original.jpg',
            large2x: 'https://cdn.example/11-large2x.jpg',
            large: 'https://cdn.example/11-large.jpg',
            medium: 'https://cdn.example/11-medium.jpg',
            small: 'https://cdn.example/11-small.jpg',
          },
        },
      ],
    })
  }
  if (u.pathname === '/pexels/videos/search') {
    return json({
      total_results: 1,
      videos: [
        {
          id: 22,
          width: 1920,
          height: 1080,
          duration: 12,
          url: 'https://www.pexels.com/video/22/',
          image: 'https://cdn.example/22-thumb.jpg',
          user: { name: 'Bo', url: 'https://www.pexels.com/@bo' },
          video_files: [
            { link: 'https://cdn.example/22-4k.mp4', file_type: 'video/mp4', width: 3840, height: 2160 },
            { link: 'https://cdn.example/22-1080.mp4', file_type: 'video/mp4', width: 1920, height: 1080 },
            { link: 'https://cdn.example/22-720.mp4', file_type: 'video/mp4', width: 1280, height: 720 },
          ],
        },
      ],
    })
  }
  if (u.pathname === '/pixabay/api/') {
    return json({
      totalHits: 30,
      hits: [
        {
          id: 33,
          tags: '雨, 街道, 夜景',
          user: 'Cai',
          user_id: 77,
          pageURL: 'https://pixabay.com/photos/33/',
          previewURL: 'https://cdn.example/33-preview.jpg',
          webformatURL: 'https://cdn.example/33-web.jpg',
          largeImageURL: 'https://cdn.example/33-large.jpg',
          imageWidth: 3000,
          imageHeight: 2000,
        },
      ],
    })
  }
  if (u.pathname === '/pixabay/api/videos/') {
    return json({
      totalHits: 1,
      hits: [
        {
          id: 44,
          tags: '城市, 延时',
          user: 'Ding',
          user_id: 88,
          pageURL: 'https://pixabay.com/videos/44/',
          duration: 9,
          videos: {
            large: { url: 'https://cdn.example/44-large.mp4', width: 1920, height: 1080, size: 5000, thumbnail: 'https://cdn.example/44-thumb.jpg' },
            medium: { url: 'https://cdn.example/44-medium.mp4', width: 1280, height: 720, size: 2000, thumbnail: '' },
          },
        },
      ],
    })
  }
  if (u.pathname === '/openverse/v1/images/') {
    return json({
      result_count: 1,
      page_count: 1,
      results: [
        {
          id: 'ov-img-1',
          title: '雾中森林',
          creator: 'Eve',
          creator_url: 'https://example.org/eve',
          foreign_landing_url: 'https://example.org/photo/1',
          license: 'cc0',
          license_version: '1.0',
          license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
          thumbnail: 'https://cdn.example/ov1-thumb.jpg',
          width: 1200,
          height: 800,
          files: [
            { url: 'https://cdn.example/ov1.jpg', filetype: 'image/jpeg', width: 1200, height: 800, filesize: 100 },
          ],
        },
      ],
    })
  }
  if (u.pathname === '/openverse/v1/audio/') {
    return json({
      result_count: 1,
      page_count: 1,
      results: [
        {
          id: 'ov-aud-1',
          title: '雨声环境',
          creator: 'Fox',
          creator_url: 'https://example.org/fox',
          foreign_landing_url: 'https://example.org/audio/1',
          license: 'by',
          license_version: '4.0',
          license_url: 'https://creativecommons.org/licenses/by/4.0/',
          thumbnail: 'https://cdn.example/ov2-thumb.jpg',
          duration: 45000,
          files: [{ url: 'https://cdn.example/ov2.mp3', filetype: 'audio/mpeg', filesize: 900 }],
          alt_files: [{ url: 'https://cdn.example/ov2.ogg', filetype: 'audio/ogg', filesize: 700 }],
        },
      ],
    })
  }
  if (u.pathname === '/unsplash/search/photos') {
    return json({
      total: 33,
      total_pages: 3,
      results: [
        {
          id: 'us-1',
          width: 4000,
          height: 3000,
          alt_description: '雾中森林小屋',
          description: '',
          user: { name: 'Gil', links: { html: 'https://unsplash.com/@gil' } },
          links: {
            html: 'https://unsplash.com/photos/us-1',
            download_location: 'https://mock.example/unsplash/photos/us-1/download?ixid=abc',
          },
          urls: {
            raw: 'https://cdn.example/us1-raw.jpg',
            full: 'https://cdn.example/us1-full.jpg',
            regular: 'https://cdn.example/us1-regular.jpg',
            small: 'https://cdn.example/us1-small.jpg',
          },
        },
      ],
    })
  }
  if (u.pathname === '/coverr/videos') {
    return json({
      page: 0,
      pages: 2,
      page_size: 20,
      total: 3,
      hits: [
        {
          id: 'cv-1',
          title: '雨夜城市',
          duration: 14.5,
          is_premium: false,
          max_width: 1920,
          max_height: 1080,
          poster: 'https://cdn.example/cv1.jpg',
          urls: {
            mp4_download: 'https://cdn.example/cv1-1080.mp4',
            mp4: 'https://cdn.example/cv1-720.mp4',
            poster: 'https://cdn.example/cv1.jpg',
          },
        },
        {
          id: 'cv-premium',
          title: '付费素材',
          is_premium: true,
          urls: { mp4_download: 'https://cdn.example/premium.mp4' },
        },
      ],
    })
  }
  return json({ error: { message: 'no route' } }, 404)
}

resetStockState()
section('Pexels 检索')
const pxSearch = await searchStock({
  provider: 'pexels',
  mediaType: 'image',
  query: '雨夜 街道',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check('返回归一化条目', pxSearch.items.length === 1 && pxSearch.items[0].provider === 'pexels')
const pxItem = pxSearch.items[0]
check(
  '作者/源页面/许可证',
  pxItem.author === 'Ada' &&
    pxItem.sourceUrl === 'https://www.pexels.com/photo/11/' &&
    pxItem.license.name === 'Pexels License' &&
    pxItem.license.requiresAttribution === false,
  JSON.stringify(pxItem.license),
)
check(
  '下载变体按面积取最大',
  pickVariant(pxItem).url === 'https://cdn.example/11-original.jpg',
  pickVariant(pxItem)?.url,
)
check('结果带导入令牌', /^stk_/.test(pxItem.token || ''))
check('关键词与分页参数', mockSeen.at(-1).search.get('query') === '雨夜 街道' && mockSeen.at(-1).search.get('page') === '1')
check('Pexels 用裸 Key 头', mockSeen.at(-1).headers.Authorization === 'px', mockSeen.at(-1).headers.Authorization)

resetStockState()
const pxVideo = await searchStock({
  provider: 'pexels',
  mediaType: 'video',
  query: 'city night',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check('视频归一化', pxVideo.items[0]?.mediaType === 'video' && pxVideo.items[0]?.duration === 12)
check(
  '视频变体不超过 1080p',
  pickVariant(pxVideo.items[0]).url === 'https://cdn.example/22-1080.mp4',
  pickVariant(pxVideo.items[0])?.url,
)

resetStockState()
section('Pixabay 检索')
const pbSearch = await searchStock({
  provider: 'pixabay',
  mediaType: 'image',
  query: '雨夜',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
const pbItem = pbSearch.items[0]
check(
  '中文检索参数',
  mockSeen.at(-1).search.get('lang') === 'zh' &&
    mockSeen.at(-1).search.get('safesearch') === 'true' &&
    mockSeen.at(-1).search.get('key') === 'pb',
)
check('图片字段归一化', pbItem.title === '雨, 街道, 夜景' && pbItem.author === 'Cai')
check('分页 hasMore 来自总数', pbSearch.hasMore === true && pbSearch.total === 30, JSON.stringify({ hasMore: pbSearch.hasMore, total: pbSearch.total }))
check('最大图变体', pickVariant(pbItem).url === 'https://cdn.example/33-large.jpg')

resetStockState()
const pbVideo = await searchStock({
  provider: 'pixabay',
  mediaType: 'video',
  query: '城市',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check(
  '视频选 large 变体并带缩略图',
  pickVariant(pbVideo.items[0]).url === 'https://cdn.example/44-large.mp4' &&
    pbVideo.items[0].thumbnailUrl === 'https://cdn.example/44-thumb.jpg',
)

resetStockState()
section('Openverse 检索')
const ovImage = await searchStock({
  provider: 'openverse',
  mediaType: 'image',
  query: 'forest',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check(
  'CC0 不要求署名',
  ovImage.items[0]?.license.name === 'CC0 1.0' && ovImage.items[0]?.license.requiresAttribution === false,
  JSON.stringify(ovImage.items[0]?.license),
)
const ovAudio = await searchStock({
  provider: 'openverse',
  mediaType: 'audio',
  query: 'rain',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check('音频 duration 毫秒归一化', ovAudio.items[0]?.duration === 45, String(ovAudio.items[0]?.duration))
check(
  'CC-BY 要求署名且带署名文本',
  ovAudio.items[0]?.license.requiresAttribution === true &&
    /Fox/.test(ovAudio.items[0]?.license.attribution) &&
    /CC BY 4\.0/.test(ovAudio.items[0]?.license.attribution),
  ovAudio.items[0]?.license.attribution,
)
check(
  'alt_files 也进入变体',
  ovAudio.items[0]?.variants.length === 2 && ovAudio.items[0].variants.some((v) => v.url.endsWith('.ogg')),
)

// ---------------------------------------------------------------- 中文关键词翻译

section('中文关键词翻译')

resetStockState()
const zhResult = await searchStock({
  provider: 'pexels',
  mediaType: 'image',
  query: '中国',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check(
  '中文关键词命中术语表并翻译',
  zhResult.query === 'china' &&
    zhResult.requestedQuery === '中国' &&
    zhResult.translated?.via === 'glossary' &&
    zhResult.translated?.to === 'china',
  JSON.stringify({ query: zhResult.query, requestedQuery: zhResult.requestedQuery, translated: zhResult.translated }),
)
const pexelsSeen = mockSeen.filter((s) => s.path === '/pexels/v1/search')
check('来源收到的是译后词', pexelsSeen.at(-1)?.search.get('query') === 'china', pexelsSeen.at(-1)?.search.toString())

// 缓存键用译后词：中英文两种写法命中同一份缓存
const enAlias = await searchStock({
  provider: 'pexels',
  mediaType: 'image',
  query: 'china',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check('译词与原词共用缓存', enAlias.cached === true, `cached=${enAlias.cached}`)
check('英文词不产生 translated', enAlias.translated === undefined)

const modelTranslated = await searchStock({
  provider: 'pexels',
  mediaType: 'image',
  query: '量子纠缠',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
  chat: async () => 'quantum entanglement',
})
check(
  '模型兜底翻译成功',
  modelTranslated.query === 'quantum entanglement' && modelTranslated.translated?.via === 'model',
  JSON.stringify(modelTranslated.translated),
)
check(
  '模型译词也发给了来源',
  mockSeen.filter((s) => s.path === '/pexels/v1/search').at(-1)?.search.get('query') === 'quantum entanglement',
)

const failedTranslation = await searchStock({
  provider: 'pexels',
  mediaType: 'image',
  query: '时空折叠',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
  chat: async () => {
    throw new Error('模型不可用')
  },
})
check(
  '翻译失败降级为原词并标记',
  failedTranslation.translateFailed === true &&
    failedTranslation.query === '时空折叠' &&
    failedTranslation.translated === undefined,
  JSON.stringify({ query: failedTranslation.query, translateFailed: failedTranslation.translateFailed }),
)
check(
  '翻译失败不伪造空结果',
  failedTranslation.items.length > 0,
  `items=${failedTranslation.items.length}`,
)

// ---------------------------------------------------------------- Unsplash

section('Unsplash 检索')

resetStockState()
const usSearch = await searchStock({
  provider: 'unsplash',
  mediaType: 'image',
  query: 'forest fog',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
const usItem = usSearch.items[0]
check('Unsplash 返回归一化条目', usSearch.items.length === 1 && usItem?.provider === 'unsplash')
check(
  'Unsplash 作者/源页面/许可',
  usItem?.author === 'Gil' &&
    usItem?.authorUrl === 'https://unsplash.com/@gil' &&
    usItem?.sourceUrl === 'https://unsplash.com/photos/us-1' &&
    usItem?.license.name === 'Unsplash License' &&
    usItem?.license.requiresAttribution === false,
  JSON.stringify({ author: usItem?.author, license: usItem?.license }),
)
check(
  'Unsplash variants 非空且按清晰度排列',
  usItem?.variants.length === 3 && usItem.variants[0].url.endsWith('-raw.jpg'),
  JSON.stringify(usItem?.variants?.map((v) => v.url)),
)
check('Unsplash 带缩略图与预览', Boolean(usItem?.thumbnailUrl) && Boolean(usItem?.previewUrl))
check(
  'Unsplash 请求带 Client-ID 与 Accept-Version',
  mockSeen.some(
    (s) => s.path === '/unsplash/search/photos' && s.headers.Authorization === 'Client-ID us' && s.headers['Accept-Version'] === 'v1',
  ),
  JSON.stringify(mockSeen.find((s) => s.path === '/unsplash/search/photos')?.headers),
)
check('Unsplash hasMore 按总页数', usSearch.hasMore === true)

// 额度裁剪：perPage 上限 20
resetStockState()
await searchStock({
  provider: 'unsplash',
  mediaType: 'image',
  query: 'forest',
  perPage: 50,
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check(
  'Unsplash perPage 裁剪到 20',
  mockSeen.filter((s) => s.path === '/unsplash/search/photos').at(-1)?.search.get('per_page') === '20',
)

// 超出页码上限：不再请求来源
resetStockState()
const beforeOverPage = mockHits
const overPage = await searchStock({
  provider: 'unsplash',
  mediaType: 'image',
  query: 'forest',
  page: 99,
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check(
  'Unsplash 超页码不请求来源',
  overPage.items.length === 0 && overPage.hasMore === false && mockHits === beforeOverPage,
  `hits=${beforeOverPage}->${mockHits} items=${overPage.items.length}`,
)

const statusFetch = (status) => async () =>
  new Response(JSON.stringify({ errors: ['boom'] }), { status, headers: { 'content-type': 'application/json' } })
let us429 = ''
try {
  await searchStock({
    provider: 'unsplash',
    mediaType: 'image',
    query: 'forest',
    settings: enabledSettings,
    env: {},
    fetchImpl: statusFetch(429),
  })
} catch (e) {
  us429 = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('Unsplash 429 映射为 rate-limit', /^rate-limit:/.test(us429), us429)

let us401 = ''
try {
  await searchStock({
    provider: 'unsplash',
    mediaType: 'image',
    query: 'forest',
    settings: enabledSettings,
    env: {},
    fetchImpl: statusFetch(401),
  })
} catch (e) {
  us401 = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('Unsplash 401 映射为 auth', /^auth:/.test(us401), us401)

// ---------------------------------------------------------------- Coverr

section('Coverr 检索')

resetStockState()
const cvSearch = await searchStock({
  provider: 'coverr',
  mediaType: 'video',
  query: 'rain city',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
const cvItem = cvSearch.items[0]
check('Coverr 返回归一化条目', cvSearch.items.length === 1 && cvItem?.provider === 'coverr')
check(
  'Coverr 取 mp4_download 与封面',
  cvItem?.variants[0]?.url === 'https://cdn.example/cv1-1080.mp4' &&
    cvItem?.thumbnailUrl === 'https://cdn.example/cv1.jpg' &&
    cvItem?.duration === 14.5 &&
    cvItem?.width === 1920,
  JSON.stringify({ variant: cvItem?.variants?.[0], thumb: cvItem?.thumbnailUrl }),
)
check('Coverr 过滤付费素材', !cvSearch.items.some((i) => i.itemId === 'cv-premium'))
check('Coverr 带导入令牌', typeof cvItem?.token === 'string')
check(
  'Coverr page 从 0 开始',
  mockSeen.filter((s) => s.path === '/coverr/videos').at(-1)?.search.get('page') === '0',
)
check(
  'Coverr 请求带 Key 与 urls=true',
  mockSeen.filter((s) => s.path === '/coverr/videos').at(-1)?.search.get('urls') === 'true' &&
    mockSeen.filter((s) => s.path === '/coverr/videos').at(-1)?.headers.Authorization === 'Bearer cv',
  JSON.stringify(mockSeen.filter((s) => s.path === '/coverr/videos').at(-1)?.headers),
)
check('Coverr hasMore 按总页数', cvSearch.hasMore === true)

const cvPage2 = await searchStock({
  provider: 'coverr',
  mediaType: 'video',
  query: 'rain city',
  page: 2,
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check(
  'Coverr 第二页页码自增且 hasMore 收敛',
  mockSeen.filter((s) => s.path === '/coverr/videos').at(-1)?.search.get('page') === '1' && cvPage2.hasMore === false,
)

const beforeCvOver = mockHits
const cvOver = await searchStock({
  provider: 'coverr',
  mediaType: 'video',
  query: 'rain city',
  page: 9,
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check('Coverr 超页码不请求来源', cvOver.items.length === 0 && mockHits === beforeCvOver)

let cv429 = ''
try {
  await searchStock({
    provider: 'coverr',
    mediaType: 'video',
    query: 'rain',
    settings: enabledSettings,
    env: {},
    fetchImpl: statusFetch(429),
  })
} catch (e) {
  cv429 = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('Coverr 429 映射为 rate-limit', /^rate-limit:/.test(cv429), cv429)

// ---------------------------------------------------------------- Mixkit

section('Mixkit 页面解析')

const mixkitSearchHtml = fs.readFileSync('tests/fixtures/mixkit-search.html', 'utf8')
const mixkitDetailHtml = fs.readFileSync('tests/fixtures/mixkit-detail.html', 'utf8')
// 导入只校验 Content-Type 与大小，这里给一段占位字节
const mp4Bytes = Buffer.from('fake-mp4-bytes-for-verify')
const mixkitSeen = []
/** 导入阶段不做 SSRF 断言：这里验证的是页面解析与变体回退 */
const mixkitAllowAll = async (u) => new URL(String(u))
/** 列表页/详情页都回 fixture；mp4 回字节，支持按清晰度单独造错 */
const mixkitFetch = (opts = {}) => async (url, init = {}) => {
  const u = new URL(String(url))
  mixkitSeen.push({ url: String(url), path: u.pathname, headers: init.headers || {} })
  if (u.pathname.endsWith('.mp4')) {
    if (opts.forbidden && u.pathname.includes(opts.forbidden)) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    }
    return new Response(mp4Bytes, {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': String(mp4Bytes.length) },
    })
  }
  if (u.pathname.includes('/free-stock-video/')) {
    if (opts.detailFails && /-\d+\/$/.test(u.pathname)) return new Response('boom', { status: 500 })
    return new Response(/-(\d+)\/?$/.test(u.pathname) && opts.detailPage !== false ? mixkitDetailHtml : mixkitSearchHtml, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
  }
  return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
}

resetStockState()
mixkitSeen.length = 0
const mkSearch = await searchStock({
  provider: 'mixkit',
  mediaType: 'video',
  query: 'rain',
  settings: enabledSettings,
  env: {},
  fetchImpl: mixkitFetch(),
})
check('Mixkit 解析出 24 条', mkSearch.items.length === 24, `count=${mkSearch.items.length}`)
check(
  'Mixkit 首条字段齐全',
  mkSearch.items[0]?.itemId === '25375' &&
    mkSearch.items[0]?.title === 'Soft rain and sun shine' &&
    mkSearch.items[0]?.mediaType === 'video' &&
    mkSearch.items[0]?.variants[0]?.height === 360 &&
    typeof mkSearch.items[0]?.token === 'string',
  JSON.stringify(mkSearch.items[0] && { id: mkSearch.items[0].itemId, v: mkSearch.items[0].variants[0] }),
)
check(
  'Mixkit 来源页面是绝对地址',
  mkSearch.items[0]?.sourceUrl ===
    'https://mock.example/mixkit/free-stock-video/soft-rain-and-sun-shine-25375/',
  mkSearch.items[0]?.sourceUrl,
)
check(
  'Mixkit 走路径式 slug 而不是 ?q=',
  mixkitSeen[0]?.path === '/mixkit/free-stock-video/rain/' && !mixkitSeen[0]?.url.includes('?q='),
  mixkitSeen[0]?.url,
)
check('Mixkit 分页信息按状态页封顶', mkSearch.hasMore === true)

// 中文词先翻译再拼 slug
resetStockState()
mixkitSeen.length = 0
await searchStock({
  provider: 'mixkit',
  mediaType: 'video',
  query: '霓虹',
  settings: enabledSettings,
  env: {},
  fetchImpl: mixkitFetch(),
})
check(
  '中文词翻译后才拼进 slug',
  mixkitSeen[0]?.path === '/mixkit/free-stock-video/neon/',
  mixkitSeen[0]?.url,
)

// 中文未翻译：不发请求，直接空结果 + translateFailed，不拼中文 slug
resetStockState()
mixkitSeen.length = 0
const mkZhUntranslated = await searchStock({
  provider: 'mixkit',
  mediaType: 'video',
  query: '时空折叠',
  settings: enabledSettings,
  env: {},
  fetchImpl: mixkitFetch(),
})
check(
  '未翻译的中文不拼成中文 slug 也不请求来源',
  mkZhUntranslated.items.length === 0 &&
    mkZhUntranslated.translateFailed === true &&
    mixkitSeen.length === 0,
  `items=${mkZhUntranslated.items.length} seen=${mixkitSeen.length}`,
)

// 0 条目的两种语义
resetStockState()
const emptyGridHtml = mixkitSearchHtml.replace(
  /data-item-grid--video-player-item-id-value="\d+"[\s\S]*?(?=data-item-grid--video-player-item-id-value="|<\/body>)/g,
  '',
)
const mkEmpty = await searchStock({
  provider: 'mixkit',
  mediaType: 'video',
  query: 'rain',
  settings: enabledSettings,
  env: {},
  fetchImpl: async () => new Response(emptyGridHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
})
check('容器在但无条目 = 正常空结果', mkEmpty.items.length === 0 && mkEmpty.hasMore === false)

resetStockState()
let mkShapeErr = ''
try {
  await searchStock({
    provider: 'mixkit',
    mediaType: 'video',
    query: 'rain',
    settings: enabledSettings,
    env: {},
    fetchImpl: async () => new Response('<html><body><div id="app"></div></body></html>', { status: 200 }),
  })
} catch (e) {
  mkShapeErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('容器缺失 = provider 结构错误', /^provider:/.test(mkShapeErr) && /结构/.test(mkShapeErr), mkShapeErr)

// 导入：补 720p、详情失败退回 360、720 被拒退回 360
createProject(PROJECTS, 'stock-mixkit')
resetStockState()
const mkImportSource = await searchStock({
  provider: 'mixkit',
  mediaType: 'video',
  query: 'rain',
  settings: enabledSettings,
  env: {},
  fetchImpl: mixkitFetch(),
})
const mkToken = mkImportSource.items[0].token

const mk720 = await importStockItem({
  token: mkToken,
  project: 'stock-mixkit',
  root: PROJECTS,
  settings: enabledSettings,
  env: {},
  fetchImpl: mixkitFetch(),
  assertPublic: mixkitAllowAll,
})
check(
  'Mixkit 导入取 720p 并补时长',
  mk720.url.endsWith('stock-mixkit-25375.mp4') && mk720.meta?.height === 720 && mk720.meta?.duration === 23,
  JSON.stringify({ url: mk720.url, h: mk720.meta?.height, d: mk720.meta?.duration }),
)
check(
  'Mixkit 导入前只抓一次详情页',
  mixkitSeen.filter((s) => s.path.endsWith('-25375/')).length === 1,
  String(mixkitSeen.filter((s) => s.path.endsWith('-25375/')).length),
)

// 720 被拒：退回列表页的 360
fs.rmSync(path.join(projectMediaDir(PROJECTS, 'stock-mixkit'), 'stock-mixkit-25375.mp4'))
mixkitSeen.length = 0
const mkFallback = await importStockItem({
  token: mkToken,
  project: 'stock-mixkit',
  root: PROJECTS,
  settings: enabledSettings,
  env: {},
  fetchImpl: mixkitFetch({ forbidden: '-720.mp4' }),
  assertPublic: mixkitAllowAll,
})
check(
  '720 被拒时退回 360',
  projectMediaExists(PROJECTS, 'stock-mixkit', 'stock-mixkit-25375.mp4') &&
    mixkitSeen.some((s) => s.path.endsWith('-720.mp4')) &&
    mixkitSeen.some((s) => s.path.endsWith('-360.mp4')),
  JSON.stringify(mixkitSeen.map((s) => s.path)),
)

// 详情页失败：直接用检索结果里的 360
fs.rmSync(path.join(projectMediaDir(PROJECTS, 'stock-mixkit'), 'stock-mixkit-25375.mp4'))
mixkitSeen.length = 0
const mkDetailFail = await importStockItem({
  token: mkToken,
  project: 'stock-mixkit',
  root: PROJECTS,
  settings: enabledSettings,
  env: {},
  fetchImpl: mixkitFetch({ detailFails: true }),
  assertPublic: mixkitAllowAll,
})
check(
  '详情页失败仍能用 360 落盘',
  projectMediaExists(PROJECTS, 'stock-mixkit', 'stock-mixkit-25375.mp4') &&
    mixkitSeen.some((s) => s.path.endsWith('-360.mp4')) &&
    !mixkitSeen.some((s) => s.path.endsWith('-720.mp4')),
  JSON.stringify(mixkitSeen.map((s) => s.path)),
)
check('详情页失败时导入仍返回站内地址', /^\/project-assets\/stock-mixkit\//.test(mkDetailFail.url))

// ---------------------------------------------------------------- VJShi 外链

section('VJShi 外链来源')

resetStockState()
let vjFetchHits = 0
const vjFetch = async () => {
  vjFetchHits++
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
}
let vjSearchErr = ''
try {
  await searchStock({
    provider: 'vjshi',
    mediaType: 'video',
    query: '中国',
    settings: enabledSettings,
    env: {},
    fetchImpl: vjFetch,
  })
} catch (e) {
  vjSearchErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('外链来源检索返回 bad-request', /^bad-request:/.test(vjSearchErr), vjSearchErr)
check('外链来源检索零请求', vjFetchHits === 0, String(vjFetchHits))

let vjImportErr = ''
try {
  await importStockItem({
    token: issueStockToken({
      provider: 'vjshi',
      itemId: 'v-1',
      mediaType: 'video',
      title: 't',
      author: '',
      authorUrl: '',
      sourceUrl: 'https://www.vjshi.com/watch/1',
      license: { name: 'VJShi', url: '', attribution: '', requiresAttribution: false },
      thumbnailUrl: '',
      previewUrl: '',
      variants: [{ url: 'https://cdn.example/v-1.mp4', mime: 'video/mp4' }],
    }),
    project: 'stock-a',
    root: PROJECTS,
    settings: enabledSettings,
    env: {},
    fetchImpl: vjFetch,
    assertPublic: mixkitAllowAll,
  })
} catch (e) {
  vjImportErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('外链来源导入返回 bad-request', /^bad-request:/.test(vjImportErr), vjImportErr)
check('外链来源导入零请求', vjFetchHits === 0, String(vjFetchHits))

// ---------------------------------------------------------------- 缓存与令牌

resetStockState()
section('缓存与令牌')
mockHits = 0
const first = await searchStock({
  provider: 'pexels',
  mediaType: 'image',
  query: '雨夜 街道',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
const hitsAfterFirst = mockHits
const second = await searchStock({
  provider: 'pexels',
  mediaType: 'image',
  query: '雨夜 街道',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
})
check('相同条件命中缓存', second.cached === true && first.cached === false)
check('缓存命中不请求来源', mockHits === hitsAfterFirst, `${hitsAfterFirst} -> ${mockHits}`)
check('缓存结果保留令牌', typeof second.items[0]?.token === 'string')

const later = await searchStock({
  provider: 'pexels',
  mediaType: 'image',
  query: '雨夜 街道',
  settings: enabledSettings,
  env: {},
  fetchImpl: mockFetch,
  now: Date.now() + 11 * 60 * 1000,
})
check('TTL 过期后重新请求', later.cached === false && mockHits === hitsAfterFirst + 1)

let shortQuery = ''
try {
  await searchStock({ provider: 'pexels', query: '雨', settings: enabledSettings, fetchImpl: mockFetch })
} catch (e) {
  shortQuery = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('过短关键词被拒且不请求', /^bad-request:/.test(shortQuery), shortQuery)

let badType = ''
try {
  await searchStock({ provider: 'pexels', mediaType: 'audio', query: 'rain', settings: enabledSettings, fetchImpl: mockFetch })
} catch (e) {
  badType = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('不支持的媒体类型被拒', /^bad-request:/.test(badType), badType)

let noKeyErr = ''
try {
  await searchStock({
    provider: 'pexels',
    query: 'rain',
    settings: { providers: { pexels: { enabled: true, apiKey: '' } } },
    env: {},
    fetchImpl: mockFetch,
  })
} catch (e) {
  noKeyErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('缺 Key 不请求来源', /^auth:/.test(noKeyErr), noKeyErr)

const rateLimited = async () => new Response(JSON.stringify({ error: { message: 'rate limit exceeded' } }), { status: 429 })
let rlErr = ''
try {
  await searchStock({
    provider: 'pexels',
    query: 'rate',
    settings: enabledSettings,
    env: {},
    fetchImpl: rateLimited,
  })
} catch (e) {
  rlErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('429 映射为 rate-limit', /^rate-limit:/.test(rlErr), rlErr)

// ---------------------------------------------------------------- 5. 导入流水线

section('导入流水线')
resetStockState()

const pixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const importHits = []
const downloadFetch = (contentType = 'image/png', bytes = pixelPng, opts = {}) => async (url, init = {}) => {
  importHits.push({ url: String(url), init })
  if (opts.status && opts.status !== 200) {
    return new Response(JSON.stringify({ error: { message: opts.message || 'boom' } }), { status: opts.status })
  }
  const body = opts.bodyOnly ? null : bytes
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': String(bytes.length) },
  })
}
const allowAll = async (u) => new URL(String(u))
const publicOnly = async (u) => {
  const h = new URL(String(u)).hostname
  if (h === 'localhost' || h === '127.0.0.1' || /^10\./.test(h)) throw new Error('不允许访问内网地址')
  return new URL(String(u))
}

const searchOnce = async (overrides = {}) => {
  resetStockState()
  return searchStock({
    provider: 'pexels',
    mediaType: 'image',
    query: 'import me',
    settings: enabledSettings,
    env: {},
    fetchImpl: mockFetch,
    ...overrides,
  })
}

// 把一条标记过的条目塞进令牌表：直接走 searchStock 更贴近真实链路
const found = await searchOnce()
const importToken = found.items[0].token

const imported = await importStockItem({
  token: importToken,
  project: 'stock-a',
  root: PROJECTS,
  settings: enabledSettings,
  env: {},
  fetchImpl: downloadFetch('image/png'),
  assertPublic: allowAll,
})
check(
  '导入成功并写站内地址',
  /^\/project-assets\/stock-a\/stock-pexels-11\.png$/.test(imported.url) && imported.reused === false,
  imported.url,
)
check('文件落盘', projectMediaExists(PROJECTS, 'stock-a', 'stock-pexels-11.png'))
const meta = findStockImportByUrl(PROJECTS, 'stock-a', imported.url)
check(
  '来源元数据落库',
  meta?.author === 'Ada' && meta?.license === 'Pexels License' && meta?.bytes === pixelPng.length,
  JSON.stringify(meta),
)

const again = await importStockItem({
  token: importToken,
  project: 'stock-a',
  root: PROJECTS,
  settings: enabledSettings,
  env: {},
  fetchImpl: downloadFetch('image/png'),
  assertPublic: allowAll,
})
check('重复导入复用文件', again.reused === true && again.url === imported.url)
check('重复导入只请求一次下载', importHits.length === 1, String(importHits.length))

const otherProject = await importStockItem({
  token: importToken,
  project: 'stock-b',
  root: PROJECTS,
  settings: enabledSettings,
  env: {},
  fetchImpl: downloadFetch('image/png'),
  assertPublic: allowAll,
})
check('跨项目各自落盘', otherProject.url.startsWith('/project-assets/stock-b/') && otherProject.reused === false)

// 文件被删后重新导入
fs.rmSync(path.join(projectMediaDir(PROJECTS, 'stock-a'), 'stock-pexels-11.png'))
const redownloaded = await importStockItem({
  token: importToken,
  project: 'stock-a',
  root: PROJECTS,
  settings: enabledSettings,
  env: {},
  fetchImpl: downloadFetch('image/png'),
  assertPublic: allowAll,
})
check('文件缺失时重新下载', redownloaded.reused === false && projectMediaExists(PROJECTS, 'stock-a', 'stock-pexels-11.png'))

// 令牌过期
let expiredErr = ''
try {
  await importStockItem({
    token: importToken,
    project: 'stock-a',
    root: PROJECTS,
    settings: enabledSettings,
    env: {},
    fetchImpl: downloadFetch('image/png'),
    assertPublic: allowAll,
    now: Date.now() + 31 * 60 * 1000,
  })
} catch (e) {
  expiredErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('令牌过期被拒', /^expired:/.test(expiredErr), expiredErr)

// 内网地址：导入时 assertPublic 拒绝
const privateFound = await searchOnce()
let privateErr = ''
try {
  await importStockItem({
    token: privateFound.items[0].token,
    project: 'stock-reject',
    root: PROJECTS,
    settings: enabledSettings,
    env: {},
    fetchImpl: downloadFetch('image/png'),
    assertPublic: async () => {
      throw new Error('不允许访问本机地址')
    },
  })
} catch (e) {
  privateErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('导入拒绝内网地址', /^bad-request:.*不允许/.test(privateErr), privateErr)

// 真实的 assertPublicUrl 也必须拦住本机/内网
let realLocal = ''
try {
  await assertPublicUrl('http://localhost:8080/x.jpg')
} catch (e) {
  realLocal = e.message
}
let realLoop = ''
try {
  await assertPublicUrl('http://127.0.0.1/x.mp4')
} catch (e) {
  realLoop = e.message
}
check('真实 SSRF 防护拒绝 localhost', /不允许访问本机/.test(realLocal), realLocal)
check('真实 SSRF 防护拒绝环回地址', /不允许访问内网/.test(realLoop), realLoop)

// 类型不符
const typeFound = await searchOnce()
let typeErr = ''
try {
  await importStockItem({
    token: typeFound.items[0].token,
    project: 'stock-reject',
    root: PROJECTS,
    settings: enabledSettings,
    env: {},
    fetchImpl: downloadFetch('text/html', Buffer.from('<html></html>')),
    assertPublic: allowAll,
  })
} catch (e) {
  typeErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('类型不符被拒', /^unsupported-type:/.test(typeErr), typeErr)
check(
  '类型不符不留文件',
  !hasPartOrExt(PROJECTS, 'stock-reject', ['.html', '.part']),
)

// 超大文件
const bigFound = await searchOnce()
let bigErr = ''
try {
  const huge = Buffer.alloc(31 * 1024 * 1024, 1)
  await importStockItem({
    token: bigFound.items[0].token,
    project: 'stock-reject',
    root: PROJECTS,
    settings: enabledSettings,
    env: {},
    fetchImpl: downloadFetch('image/png', huge),
    assertPublic: allowAll,
  })
} catch (e) {
  bigErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('超过大小上限被拒', /^too-large:/.test(bigErr), bigErr)
check('超限后不留文件', !hasPartOrExt(PROJECTS, 'stock-reject', ['.part']))

// 下载超时
const timeoutFound = await searchOnce()
let timeoutErr = ''
try {
  await importStockItem({
    token: timeoutFound.items[0].token,
    project: 'stock-reject',
    root: PROJECTS,
    settings: enabledSettings,
    env: {},
    fetchImpl: async () => {
      const e = new Error('timed out')
      e.name = 'TimeoutError'
      throw e
    },
    assertPublic: allowAll,
  })
} catch (e) {
  timeoutErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('下载超时给出 network 错误', /^network:.*下载超时/.test(timeoutErr), timeoutErr)

// 缺项目
let noProjectErr = ''
try {
  await importStockItem({
    token: importToken,
    project: '',
    root: PROJECTS,
    settings: enabledSettings,
    env: {},
    fetchImpl: downloadFetch('image/png'),
    assertPublic: allowAll,
  })
} catch (e) {
  noProjectErr = e instanceof StockError ? `${e.kind}:${e.message}` : String(e)
}
check('未选项目拒绝导入', /^bad-request:/.test(noProjectErr), noProjectErr)

// ---------------------------------------------------------------- 6. 设置单元

section('设置归一化与脱敏')

const empty = normalizeStockSettings(undefined)
check('空配置 = 没有来源', Object.keys(empty.providers).length === 0, JSON.stringify(empty))

const partial = normalizeStockSettings({
  providers: {
    pexels: { enabled: true, apiKey: 'px-1', baseUrl: 'https://mock.example/pexels/' },
    bogus: { enabled: true, apiKey: 'x' },
  },
})
check('只保留已知来源', Boolean(partial.providers.pexels) && !partial.providers.bogus)
check(
  'Base URL 去尾斜杠',
  partial.providers.pexels.baseUrl === 'https://mock.example/pexels',
  partial.providers.pexels.baseUrl,
)
const badUrl = normalizeStockSettings({ providers: { pexels: { baseUrl: 'file:///etc/passwd' } } })
check('非 http(s) Base URL 回落官方地址', badUrl.providers.pexels.baseUrl === 'https://api.pexels.com')

const envApplied = applyStockEnvDefaults(
  { providers: { pexels: { enabled: false, apiKey: '', baseUrl: '' } } },
  { PEXELS_API_KEY: 'env-key', PIXABAY_API_KEY: 'pb-env' },
)
check(
  '环境 Key 自动启用并标记来源',
  envApplied.settings.providers.pexels.apiKey === 'env-key' &&
    envApplied.settings.providers.pexels.enabled === true &&
    envApplied.fromEnv.pexels === true,
)
check(
  'Pixabay 环境 Key 同样自动启用',
  envApplied.settings.providers.pixabay.enabled === true &&
    envApplied.settings.providers.pixabay.apiKey === 'pb-env' &&
    envApplied.fromEnv.pixabay === true,
)

const own = applyStockEnvDefaults(
  { providers: { pexels: { enabled: true, apiKey: 'own', baseUrl: '' } } },
  { PEXELS_API_KEY: 'env-key' },
)
check('设置库 Key 优先于环境', own.settings.providers.pexels.apiKey === 'own' && !own.fromEnv.pexels)

const redacted = redactStockSettings(
  { providers: { pexels: { enabled: true, apiKey: 'secret', baseUrl: 'https://api.pexels.com' } } },
  {},
)
check(
  '读取脱敏不回传 Key 原文',
  redacted.providers.pexels.hasApiKey === true &&
    !Object.prototype.hasOwnProperty.call(redacted.providers.pexels, 'apiKey') &&
    !JSON.stringify(redacted).includes('secret'),
  JSON.stringify(redacted),
)
const noKey = redactStockSettings({}, {})
check('Openverse 无 Key 也可用（未启用但可配置）', noKey.providers.openverse?.hasApiKey === false)

const merged = mergeStockSettings(
  { providers: { pexels: { enabled: true, apiKey: 'keep-me', baseUrl: 'https://a.example' } } },
  { providers: { pexels: { enabled: false, apiKey: '', baseUrl: 'https://b.example' } } },
)
check(
  '空 Key 保存时保留旧值',
  merged.providers.pexels.apiKey === 'keep-me' &&
    merged.providers.pexels.enabled === false &&
    merged.providers.pexels.baseUrl === 'https://b.example',
)
const cleared = mergeStockSettings(
  { providers: { pexels: { enabled: true, apiKey: 'keep-me', baseUrl: '' } } },
  { providers: { pexels: { enabled: true, apiKey: 'new-key', baseUrl: '' } } },
)
check('新 Key 覆盖旧值', cleared.providers.pexels.apiKey === 'new-key')

const resolved = resolveStockProvider({ providers: { pexels: { enabled: true, apiKey: 'k' } } }, 'pexels', {})
check('服务端解析出有效配置', resolved?.apiKey === 'k' && resolved?.baseUrl === 'https://api.pexels.com')
check('未知来源解析为空', resolveStockProvider({}, 'nope', {}) === null)

// 新增来源的默认地址
const newDefaults = {
  unsplash: 'https://api.unsplash.com',
  coverr: 'https://api.coverr.co',
  mixkit: 'https://mixkit.co',
  vjshi: 'https://www.vjshi.com',
}
for (const [id, baseUrl] of Object.entries(newDefaults)) {
  const cfg = resolveStockProvider({}, id, {})
  check(`${id} 解析出默认地址`, cfg?.baseUrl === baseUrl, JSON.stringify(cfg))
}

const kindDefaults = normalizeStockSettings({ providers: { mixkit: {}, vjshi: {}, unsplash: {} } })
check(
  'html / link 默认开启，需 Key 的来源默认关闭',
  kindDefaults.providers.mixkit.enabled === true &&
    kindDefaults.providers.vjshi.enabled === true &&
    kindDefaults.providers.unsplash.enabled === false,
  JSON.stringify(kindDefaults),
)
const kindExplicitOff = normalizeStockSettings({ providers: { mixkit: { enabled: false } } })
check('显式关闭的页面解析来源保持关闭', kindExplicitOff.providers.mixkit.enabled === false)

const redactedNoKey = redactStockSettings({}, {})
check(
  '脱敏输出 kind 与 requiresKey',
  redactedNoKey.providers.unsplash.kind === 'api' &&
    redactedNoKey.providers.unsplash.requiresKey === true &&
    redactedNoKey.providers.mixkit.kind === 'html' &&
    redactedNoKey.providers.mixkit.requiresKey === false &&
    redactedNoKey.providers.vjshi.kind === 'link' &&
    redactedNoKey.providers.vjshi.requiresKey === false,
  JSON.stringify(redactedNoKey.providers.mixkit),
)
check(
  '无 Key 来源不输出「未配置 Key」类字段',
  !Object.prototype.hasOwnProperty.call(redactedNoKey.providers.mixkit, 'reason') &&
    !/未配置/.test(JSON.stringify(redactedNoKey.providers.mixkit)) &&
    !/未配置/.test(JSON.stringify(redactedNoKey.providers.vjshi)),
  JSON.stringify(redactedNoKey.providers.vjshi),
)
check(
  '脱敏永远不回传 Key 原文',
  !JSON.stringify(redactStockSettings({ providers: { unsplash: { enabled: true, apiKey: 'super-secret' } } }, {})).includes(
    'super-secret',
  ),
)

// ---------------------------------------------------------------- 4. 设置接口（临时 dev server）

section('设置接口（/api/settings）')

// 桩来源：只实现 Pexels 图片检索，供路由级检索使用
const stubHits = []
const stubServer = http.createServer((req, res) => {
  stubHits.push(req.url)
  const pathname = String(req.url || '').split('?')[0]
  if (pathname === '/pexels/v1/search') {
    const q = new URL(String(req.url), 'http://x').searchParams.get('query') || ''
    const isLocal = /local/i.test(q)
    const original = isLocal
      ? `http://127.0.0.1:${stubServer.address().port}/local.jpg`
      : 'https://cdn.example/11-original.jpg'
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        total_results: 1,
        photos: [
          {
            id: isLocal ? 99 : 11,
            width: 4000,
            height: 3000,
            url: 'https://www.pexels.com/photo/11/',
            photographer: 'Ada',
            photographer_url: 'https://www.pexels.com/@ada',
            alt: '雨夜霓虹街道',
            src: {
              original,
              large2x: original,
              medium: original,
            },
          },
        ],
      }),
    )
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'no route' } }))
})
await new Promise((r) => stubServer.listen(0, '127.0.0.1', r))
const STUB_PORT = stubServer.address().port

const PORT = 5367
const APP = `http://127.0.0.1:${PORT}`
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  {
    cwd: ROOT,
    env: { ...process.env, SB_PROJECTS_DIR: PROJECTS, PEXELS_API_KEY: '', PIXABAY_API_KEY: '' },
    stdio: 'ignore',
  },
)

const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  const j = await r.json().catch(() => ({}))
  return { status: r.status, ...j }
}

try {
  const up = await waitServer()
  check('dev server 启动', up)
  if (!up) throw new Error('dev server 未启动')

  const saved = await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stock: {
        providers: {
          pexels: { enabled: true, apiKey: 'px-secret', baseUrl: 'https://api.pexels.com' },
          openverse: { enabled: true, apiKey: '', baseUrl: '' },
        },
      },
    }),
  })
  check('保存来源设置成功', saved.ok === true, saved.message || '')
  const read1 = await api('/api/settings')
  const stock1 = read1.settings?.stock
  check(
    '读回只给 hasApiKey',
    stock1?.providers?.pexels?.hasApiKey === true &&
      !Object.prototype.hasOwnProperty.call(stock1.providers.pexels, 'apiKey'),
    JSON.stringify(stock1),
  )
  check(
    '读回不含 Key 原文',
    !JSON.stringify(read1).includes('px-secret'),
  )
  check('Openverse 无 Key 也可配置', stock1?.providers?.openverse?.hasApiKey === false)

  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock: { providers: { pexels: { enabled: false, apiKey: '', baseUrl: '' } } } }),
  })
  const read2 = await api('/api/settings')
  check(
    '空 Key 保存不清除旧 Key',
    read2.settings?.stock?.providers?.pexels?.hasApiKey === true &&
      read2.settings?.stock?.providers?.pexels?.enabled === false,
    JSON.stringify(read2.settings?.stock),
  )

  // ---- 路由级：来源列表 / 检索 / 导入 / 元数据 / 音频 Range ----
  section('路由级（/api/stock/*）')

  const listed = await api('/api/stock/providers')
  check(
    '来源列表带可用性',
    listed.ok === true &&
      Array.isArray(listed.providers) &&
      listed.providers.length === 7 &&
      listed.providers.find((p) => p.id === 'pexels')?.ok === false &&
      listed.providers.find((p) => p.id === 'vjshi')?.searchable === false &&
      listed.providers.find((p) => p.id === 'mixkit')?.kind === 'html',
    JSON.stringify(listed.providers?.map((p) => [p.id, p.ok, p.kind])),
  )

  // 把 pexels 指到本地 mock，并重新启用
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stock: {
        providers: { pexels: { enabled: true, apiKey: 'px-secret', baseUrl: `http://127.0.0.1:${STUB_PORT}/pexels` } },
      },
    }),
  })

  const tooShort = await api('/api/stock/search?provider=pexels&type=image&q=a')
  check('路由拒绝过短关键词', tooShort.status === 400 && tooShort.kind === 'bad-request', JSON.stringify(tooShort))
  check('过短关键词不请求来源', stubHits.length === 0, String(stubHits.length))

  const unknown = await api('/api/stock/search?provider=nope&type=image&q=rain')
  check('路由拒绝未知来源', unknown.status === 400 && unknown.kind === 'bad-request', JSON.stringify(unknown))

  const searched = await api('/api/stock/search?provider=pexels&type=image&q=rain')
  check(
    '路由检索返回结果与令牌',
    searched.ok === true && searched.items?.length === 1 && /^stk_/.test(searched.items[0].token || ''),
    JSON.stringify({ ok: searched.ok, n: searched.items?.length, message: searched.message }),
  )
  check('路由检索保留许可信息', searched.items?.[0]?.license?.name === 'Pexels License')

  const cachedSearch = await api('/api/stock/search?provider=pexels&type=image&q=rain')
  check('重复检索命中缓存', cachedSearch.cached === true)
  check('缓存命中不增加来源请求', stubHits.length === 1, String(stubHits.length))

  const rejected = await api('/api/stock/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: 'stock-a', url: 'https://evil.example/x.jpg' }),
  })
  check(
    '导入拒绝客户端地址',
    rejected.status === 400 && /只接受检索令牌/.test(rejected.message || ''),
    JSON.stringify(rejected),
  )

  // 指向本机的下载地址会被 SSRF 校验拦下：这正是路由层要保证的行为
  const localSearch = await api('/api/stock/search?provider=pexels&type=image&q=local%20only')
  const privateImport = await api('/api/stock/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: 'stock-a', token: localSearch.items?.[0]?.token }),
  })
  check(
    '路由导入拒绝本机下载地址',
    privateImport.ok === false && privateImport.kind === 'bad-request',
    JSON.stringify(privateImport),
  )

  const expiredImport = await api('/api/stock/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: 'stock-a', token: 'stk_not-a-real-token' }),
  })
  check(
    '路由拒绝无效令牌',
    expiredImport.status === 400 && expiredImport.kind === 'expired',
    JSON.stringify(expiredImport),
  )

  // 元数据路由：直接落一条来源记录（导入成功路径已在模块层验证）
  const seeded = upsertStockImport(PROJECTS, 'stock-a', {
    provider: 'pexels',
    itemId: 'route-1',
    url: '/project-assets/stock-a/stock-pexels-route-1.jpg',
    mediaType: 'image',
    title: '路由来源图',
    author: 'Ada',
    authorUrl: 'https://www.pexels.com/@ada',
    sourceUrl: 'https://www.pexels.com/photo/route-1/',
    license: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    attribution: 'Ada · Pexels License · Pexels',
  })
  const metaRoute = await api(
    `/api/stock/meta?project=stock-a&url=${encodeURIComponent(seeded.url)}`,
  )
  check(
    '路由返回来源元数据',
    metaRoute.ok === true && metaRoute.meta?.author === 'Ada' && metaRoute.meta?.license === 'Pexels License',
    JSON.stringify(metaRoute.meta),
  )
  const noMeta = await api(`/api/stock/meta?project=stock-a&url=${encodeURIComponent('/generated/plain.png')}`)
  check('普通素材 meta 为 null', noMeta.ok === true && noMeta.meta === null, JSON.stringify(noMeta))
  const otherMeta = await api(
    `/api/stock/meta?project=stock-b&url=${encodeURIComponent(seeded.url)}`,
  )
  check('元数据按项目隔离', otherMeta.ok === true && otherMeta.meta === null, JSON.stringify(otherMeta))

  // 音频按 Range 播放：写一个音频文件后请求 /project-assets/... 并检查 206
  const audioName = 'stock-openverse-audio-1.mp3'
  saveProjectMedia(PROJECTS, 'stock-a', Buffer.alloc(2048, 7), { ext: 'mp3', file: audioName })
  const audioUrl = `/project-assets/stock-a/${audioName}`
  const rangeRes = await fetch(`${APP}${audioUrl}`, { headers: { Range: 'bytes=0-99' } })
  const audioBytes = await rangeRes.arrayBuffer()
  check(
    '音频按 Range 返回 206',
    rangeRes.status === 206 && audioBytes.byteLength === 100,
    `status=${rangeRes.status} bytes=${audioBytes.byteLength}`,
  )
  check(
    '音频 Content-Type 正确',
    (rangeRes.headers.get('content-type') || '').includes('audio/'),
    rangeRes.headers.get('content-type') || '',
  )
} finally {
  child.kill('SIGTERM')
  stubServer.close()
  await new Promise((r) => setTimeout(r, 300))
}

// ---------------------------------------------------------------- 汇总

console.log(bad === 0 ? '\n✅ 全部通过' : `\n❌ ${bad} 项失败`)
process.exit(bad ? 1 : 0)
