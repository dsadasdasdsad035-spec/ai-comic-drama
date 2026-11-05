/**
 * 在线素材检索的关键词处理：中文检测、术语表与模型翻译。
 *
 * 存在理由：公开图库基本只认英文关键词。实测 Coverr 搜「中国」直接 0 条，
 * Mixkit 搜中文 slug 会回退成首页默认推荐——后者更危险，用户会把默认推荐
 * 当成搜索结果。所以关键词必须在服务端翻译，并把译词回传界面标注。
 *
 * 本模块不依赖 vite，也不发请求：模型调用由调用方注入 `chat`，
 * 便于离线单测与在路由层复用已配置的文本模型。
 */

/** 是否含中日韩统一表意文字（判断要不要翻译） */
export function detectCjk(text) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(text || ''))
}

/**
 * 高频词术语表：影视检索里反复出现的地理、场景、人物与运镜词。
 *
 * 优先术语表而不是先问模型，有三个好处：离线验收可确定、命中时零延迟、
 * 模型不可用时仍有兜底（不会退化成「原词直接搜然后空结果」）。
 */
export const STOCK_GLOSSARY = {
  中国: 'china',
  中国风: 'chinese style',
  长城: 'great wall of china',
  故宫: 'forbidden city',
  天安门: 'tiananmen',
  上海: 'shanghai',
  北京: 'beijing',
  香港: 'hong kong',
  台北: 'taipei',
  深圳: 'shenzhen',
  城市: 'city',
  城市夜景: 'city night',
  街道: 'street',
  霓虹: 'neon',
  雨夜: 'rainy night',
  下雨: 'rain',
  雪: 'snow',
  雪景: 'snow landscape',
  沙漠: 'desert',
  海洋: 'ocean',
  海浪: 'ocean waves',
  森林: 'forest',
  草原: 'grassland',
  山脉: 'mountains',
  雪山: 'snow mountain',
  日出: 'sunrise',
  日落: 'sunset',
  黄昏: 'dusk',
  云海: 'sea of clouds',
  星空: 'starry sky',
  夜空: 'night sky',
  月亮: 'moon',
  太阳: 'sun',
  咖啡: 'coffee',
  办公: 'office',
  办公室: 'office',
  会议: 'meeting',
  电脑: 'computer',
  键盘: 'keyboard',
  手机: 'smartphone',
  走路: 'walking',
  跑步: 'running',
  跑步者: 'runner',
  人物特写: 'portrait closeup',
  人像: 'portrait',
  男人: 'man',
  女人: 'woman',
  老人: 'elderly person',
  儿童: 'child',
  家庭: 'family',
  情侣: 'couple',
  厨师: 'chef',
  医生: 'doctor',
  警察: 'police',
  宇航员: 'astronaut',
  机器人: 'robot',
  汽车: 'car',
  火车: 'train',
  飞机: 'airplane',
  轮船: 'ship',
  自行车: 'bicycle',
  高速公路: 'highway',
  地铁: 'subway',
  慢动作: 'slow motion',
  延时摄影: 'timelapse',
  航拍: 'aerial view',
  俯拍: 'top down view',
  特写: 'closeup',
  背景: 'background',
  抽象: 'abstract',
  科技: 'technology',
  数据: 'data',
  商务: 'business',
  节日: 'festival',
  春节: 'chinese new year',
  烟花: 'fireworks',
  灯笼: 'lantern',
}

/** 归一化术语键：去空白与标点，全角空格也当分隔 */
function glossaryKey(text) {
  return String(text || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：！？,.!?;:'"“”‘’()（）]/g, '')
    .toLowerCase()
}

/** 术语表命中（整句精确匹配）；未命中返回空串 */
export function lookupGlossary(text) {
  const key = glossaryKey(text)
  if (!key) return ''
  return STOCK_GLOSSARY[key] || ''
}

/** 模型输出收敛：容忍 JSON / 带引号 / 多行，只接受短英文短语 */
export function sanitizeTranslated(value) {
  let s = String(value || '').trim()
  if (!s) return ''
  // 模型可能给 {"en":"china"} 或 ```json ... ```
  const jsonish = s.match(/\{[\s\S]*\}/)
  if (jsonish) {
    try {
      const j = JSON.parse(jsonish[0])
      const picked = j?.en ?? j?.english ?? j?.query ?? j?.translation
      if (typeof picked === 'string') s = picked
    } catch {
      /* 不是 JSON，按纯文本处理 */
    }
  }
  s = s
    .replace(/^```[a-z]*|```$/gi, '')
    .split(/[\r\n]+/)[0]
    .replace(/^["'`“”‘’\s]+|["'`“”‘’\s]+$/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim()
  if (!s || s.length > 80) return ''
  // 只接受拉丁字母、数字与基本标点：出现中文说明模型没按要求翻译
  if (!/^[A-Za-z0-9][A-Za-z0-9 .,'&/+-]*$/.test(s)) return ''
  return s.toLowerCase()
}

/**
 * 把关键词翻成英文。
 *
 * 顺序：不需要翻译（无中文）→ 术语表 → 注入的模型调用 → 失败原样返回。
 * 返回值里的 `failed` 让界面能明确提示「未翻译，可能没有结果」，
 * 而不是把默认推荐当成搜索结果。
 */
export async function translateQuery(input = {}) {
  const text = String(input.text || '').trim()
  const chat = typeof input.chat === 'function' ? input.chat : null
  const timeoutMs = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : 5000
  if (!text) return { query: '', via: 'none' }
  if (!detectCjk(text)) return { query: text, via: 'none' }

  const hit = lookupGlossary(text)
  if (hit) return { query: hit, via: 'glossary', translated: { from: text, to: hit, via: 'glossary' } }

  if (chat) {
    try {
      const raw = await Promise.race([
        Promise.resolve(chat(text, timeoutMs)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('翻译超时')), timeoutMs)),
      ])
      const en = sanitizeTranslated(raw)
      if (en) return { query: en, via: 'model', translated: { from: text, to: en, via: 'model' } }
    } catch {
      /* 降级到原词，下面统一打 failed */
    }
  }
  return { query: text, via: 'none', failed: true }
}

/** 翻译提示文案：界面直接展示，避免各处各写一套 */
export function translateHint(translated) {
  if (!translated || !translated.to) return ''
  const via = translated.via === 'model' ? '（模型翻译）' : '（术语表）'
  return `已把「${translated.from}」译为 ${translated.to}${via}`
}

/** 翻译失败提示：必须显式，不能静默 */
export const TRANSLATE_FAILED_HINT = '未能把中文关键词译成英文，按原词检索可能没有结果'
