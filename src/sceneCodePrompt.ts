import type { ProjectData } from './api'
import type { MediaBrief } from './mediaBrief'
import { mediaBriefText } from './mediaBrief'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import type { Shot3DContext, ShotData } from './types'
import type { Shot3DContextCatalog } from './shot3dContextCatalog'
import { itemIsSelected } from './shot3dContextCatalog'
import { selectedDialogue } from './shot3dContext'

export const SCENE_CODE_ABI = `运行时会提供：
- ctx.THREE：Three.js core
- ctx.scene / ctx.camera / ctx.renderer / ctx.canvas
- ctx.assets：Map<稳定键, { key, label, kind, texture, width, height, videoDuration?, frameTime? }>
- ctx.duration（秒）/ ctx.width / ctx.height / ctx.aspect / ctx.shot
- ctx.render() 可选，手动渲染；每帧 renderAt 返回后运行时也会渲染 scene/camera

必须定义三个顶层函数：
function init(ctx) { /* 建场景、材质、灯光、相机 */ }
function renderAt(t, mode) { /* t 是 0..duration 秒；mode 是 clean/review */ }
function dispose() { /* 释放自定义几何/材质/纹理/RenderTarget */ }

硬约束：
- 不要 import / require / fetch / XMLHttpRequest / WebSocket；不能访问 parent、top、Cookie、localStorage。
- 动画必须由 t 决定，不要用 requestAnimationFrame、Date.now、随机数表达运动；同一 t 要产生同一画面。
- 使用 ctx.assets.get('稳定键') 取选中素材纹理；素材不存在时要有兜底。
- 相机必须设置到能看到主体的位置；renderAt 中要按 t 更新运动。
- init 至少添加一个可见 mesh，并设置 ctx.camera；首帧必须产生 draw call。
- 只输出 JSON，不要 Markdown 围栏。

最小可用结构（内容可替换，但结构必须保留）：
let S;
function init(ctx) {
  S = ctx;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a9d8f })
  );
  S.scene.add(mesh);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
  ctx.camera.position.set(0, 1.5, 5);
  ctx.camera.lookAt(0, 0, 0);
}
function renderAt(t) {
  if (S) S.camera.position.x = Math.sin(t * 0.5) * 0.2;
}
function dispose() {}`

export const SCENE_CODE_SYSTEM = `你是资深 Three.js 场景导演。你会根据当前镜头文本、用户选中的素材和媒体 brief，生成一段可执行的 Three.js 代码，用于 3D 调度预演。
代码是场景的唯一真相：不要输出 ShotScene、ShotBlocking、JSON 布局或补丁，只输出完整代码。
${SCENE_CODE_ABI}

只输出：
{"reply":"给用户的一句话","code":"完整代码","motionNote":"可选：给下游视频模型的运镜/动作说明，不要声称由几何自动推导"}`

export const SCENE_CODE_CHAT_SYSTEM = `你是当前镜头的 Three.js 代码编辑助手。用户会要求你修改现有 3D 代码。
你必须返回完整的新代码，而不是片段、diff 或结构化 patch；不要修改其他镜头。
${SCENE_CODE_ABI}

只输出：
{"reply":"给用户的一句话","code":"完整代码","motionNote":"可选：更新后的运镜/动作说明"}`

export type SceneCodePromptInput = {
  shot: ShotData
  project?: ProjectData | null
  context: Shot3DContext
  catalog: Shot3DContextCatalog
  assets: PreparedSceneAsset[]
  mediaBrief?: MediaBrief
  videoBrief?: string
  currentCode?: string
  previousCode?: string
  legacyScene?: unknown
  duration: number
  aspect: string
}

export type SceneCodeResult = {
  reply: string
  code: string
  motionNote?: string
}

const clean = (v: unknown, max = 3000): string =>
  String(v ?? '')
    .replace(/data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=]+/gi, '[图片已省略]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const cleanCode = (v: unknown, max = 16000): string =>
  String(v ?? '')
    .replace(/data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=]+/gi, '[图片已省略]')
    .trim()
    .slice(0, max)

function sceneText(catalog: Shot3DContextCatalog, ctx: Shot3DContext): string[] {
  const out: string[] = []
  for (const item of catalog.scenes) {
    if (item.kind === 'scene-text' && itemIsSelected(ctx, item)) {
      out.push(`${item.label}${item.subtitle ? `（${item.subtitle}）` : ''}`)
    }
  }
  return out
}

function assetManifest(assets: PreparedSceneAsset[]): string {
  return assets
    .map((a) => {
      const bits = [
        `key=${a.ref.key}`,
        `label=${a.ref.label}`,
        `kind=${a.payload.kind}`,
        a.payload.width && a.payload.height ? `${a.payload.width}x${a.payload.height}` : '',
        a.payload.videoDuration != null ? `video=${a.payload.videoDuration.toFixed(2)}s` : '',
        a.payload.frameTime != null ? `frame@${a.payload.frameTime.toFixed(2)}s` : '',
      ].filter(Boolean)
      return `- ${bits.join(' | ')}`
    })
    .join('\n')
}

/** 代码生成/聊天共用的上下文；素材只给稳定键和 brief，不发 base64。 */
export function buildSceneCodeContext(input: SceneCodePromptInput): string {
  const s = input.shot
  const lines: string[] = []
  lines.push(
    `【镜头】${clean(s.no, 30) || '未编号'}｜${input.duration.toFixed(1)}s｜${input.aspect}｜` +
      `${clean(s.size, 20) || '未注明'}｜${clean(s.move, 20) || '未注明'}`,
  )
  if (input.context.text.prompt && s.prompt) lines.push(`【画面提示词】${clean(s.prompt, 1200)}`)
  if (input.context.text.videoPrompt && s.videoPrompt) lines.push(`【运动提示词】${clean(s.videoPrompt, 1000)}`)
  if (input.context.text.cast && s.cast?.length) lines.push(`【画面出场】${s.cast.map((x) => clean(x, 20)).join('、')}`)
  if (input.context.text.sizeMove) {
    lines.push(
      `【景别/运镜/秒数】${[clean(s.size, 20), clean(s.move, 20), `${Number(s.seconds || 0).toFixed(1)}s`]
        .filter(Boolean)
        .join(' · ')}`,
    )
  }
  const selected = selectedDialogue(input.context, s.dialogue)
  if (input.context.text.dialogue !== 'all' || selected.length) {
    if (selected.length) {
      lines.push('【选中台词】')
      for (const line of selected) lines.push(`- ${line.speaker ? `${line.speaker}：` : ''}${clean(line.text, 300)}`)
    }
  }
  if (input.context.text.marks && s.marks?.length) {
    lines.push(`【画面标注】${input.catalog.text.marks || `${s.marks.length} 个标注`}`)
  }
  const scenes = sceneText(input.catalog, input.context)
  if (scenes.length) lines.push(`【选中场次】${scenes.join('；')}`)

  const selectedAssets = input.assets.map((a) => a.ref)
  if (selectedAssets.length) {
    lines.push('【选中素材（代码用稳定键取）】')
    lines.push(assetManifest(input.assets))
  } else {
    lines.push('【选中素材】无；代码应使用几何、颜色和程序化材质')
  }
  const brief = mediaBriefText(input.mediaBrief)
  if (brief) {
    lines.push('【媒体 brief】')
    lines.push(clean(brief, 5000))
  }
  if (input.videoBrief) {
    lines.push('【原生视频理解（仅首次生成可用）】')
    lines.push(clean(input.videoBrief, 5000))
  }
  if (input.legacyScene) {
    lines.push('【旧结构化 3D（只作转换参考，不要原样输出 JSON）】')
    lines.push(clean(JSON.stringify(input.legacyScene), 6000))
  }
  if (input.previousCode) {
    lines.push('【上一镜代码（只作风格/空间连续性参考，不要假设有结构化继承）】')
    lines.push('```js\n' + cleanCode(input.previousCode, 12000) + '\n```')
  }
  if (input.currentCode) {
    lines.push('【当前代码（在此基础上改）】')
    lines.push('```js\n' + cleanCode(input.currentCode, 16000) + '\n```')
  }
  return lines.join('\n').slice(0, 28000)
}

export function buildSceneCodeGeneratePrompt(input: SceneCodePromptInput): string {
  return (
    `${buildSceneCodeContext(input)}\n\n` +
    '请生成一段完整 Three.js 调度代码。优先用选中素材做背景/纹理；没有素材就用几何与程序化材质。' +
    '不要输出 JSON 以外的内容。'
  )
}

export function buildSceneCodeChatPrompt(input: SceneCodePromptInput, userMessage: string, history: { role: 'user' | 'assistant'; text: string }[]): string {
  const recent = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${clean(m.text, 500)}`)
    .join('\n')
  return (
    `${buildSceneCodeContext(input)}\n\n` +
    (recent ? `【最近聊天】\n${recent}\n\n` : '') +
    `【用户新消息】${clean(userMessage, 2000)}\n\n` +
    '请直接修改当前代码并返回完整新代码；只输出 JSON。'
  )
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 解析代码模型输出；代码围栏在 sanitize 阶段再统一去一次。 */
export function parseSceneCodeResult(raw: unknown): SceneCodeResult {
  const o = asObj(raw)
  if (!o) throw new Error('模型没有返回 JSON 对象')
  const code = typeof o.code === 'string' ? o.code : ''
  if (!code.trim()) throw new Error('模型没有返回 code 字段')
  return {
    reply: clean(o.reply, 500) || '已生成新的 3D 代码。',
    code,
    ...(typeof o.motionNote === 'string' && o.motionNote.trim()
      ? { motionNote: clean(o.motionNote, 500) }
      : {}),
  }
}
