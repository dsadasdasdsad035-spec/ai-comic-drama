/**
 * 角色形状边界：接口形状（蛇形）与界面模型（驼峰）之间的读写约定。
 *
 * 背景：项目快照来自 `GET /api/project`，是蛇形；界面里流转的是驼峰。
 * 曾有多处把快照角色当成界面模型直接读，导致锚点被读成空、写回时被清空。
 *
 * `rg -n "\.characters\b" src/` 的复查结论（读项目角色快照的地方只有这些）：
 * - 走读入口 `readCharacters`：projectDraft 角色/提示词分支、materialTools 角色名册、
 *   builtinPlatformTools 配音取音色、App 项目水合。
 * - 透传原始形状（只读 id/name/image 这类同名同义字段）：stageTools 的素材清单与单卡读取、
 *   stageTools 的 charactersData（原样回给模型）。
 * - 非项目快照：App 的 localStorage 画布存档（本就存驼峰）、shotRefIndex / shotReferences /
 *   nativeAudio / videoPrompt / transitionGen 收的是界面模型入参、storyboardMarkdown 与
 *   shotCellSyntax 收的是镜头上的角色名字符串。
 *
 * 跑法：node verify-skills-unit.mjs（本文件在 TESTS 里登记）
 */
import assert from 'node:assert/strict'
import {
  checkCharacterWriteback,
  readCharacters,
  toProject,
  toSheet,
  type ProjectChar,
} from '../src/charMap.ts'
import type { CharacterSheet } from '../src/characters.ts'
import { mergeCharacters } from '../src/charExtract.ts'
import { applyProjectDraft, type ProjectDraftCtx } from '../src/platform/projectDraft.ts'
import { createMaterialTools } from '../src/agent/materialTools.ts'
import { createBuiltinPlatformTools } from '../src/agent/builtinPlatformTools.ts'
import type { ProjectData } from '../src/api.ts'

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error)?.message || e}`)
  }
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error)?.message || e}`)
  }
}

const snake: ProjectChar = {
  name: '陈默',
  role: '主角',
  age: '35',
  look_cn: '三十多岁中国男人，方下巴，寸头',
  look_en: 'chinese man in his mid 30s, square jaw, buzz cut',
  palette: '铁灰 + 黄铜',
  keywords: ['寸头', '风衣'],
  voice: 'male-qn-badao',
  reference_images: ['/project-assets/chenmo-1.png'],
}

// ---- 1. 读端：蛇形输入 ----
check('蛇形输入读回中英文锚点', () => {
  const s = toSheet(snake)
  assert.equal(s.lookCn, snake.look_cn)
  assert.equal(s.lookEn, snake.look_en)
  assert.equal(s.palette, snake.palette)
  assert.deepEqual(s.keywords, snake.keywords)
  assert.equal(s.voiceId, 'male-qn-badao')
  assert.deepEqual(s.referenceImages, ['/project-assets/chenmo-1.png'])
})

check('蛇形输入 id 用角色名', () => {
  assert.equal(toSheet(snake).id, '陈默')
})

// ---- 2. 读端：驼峰输入（兜底） ----
check('驼峰输入读回中英文锚点', () => {
  const camel: CharacterSheet = {
    id: '小白',
    name: '小白',
    role: '配角',
    lookCn: '白色小猫',
    lookEn: 'a small white kitten',
    palette: '白 + 灰',
    keywords: ['猫'],
    voiceId: 'cartoon_pig',
    referenceImages: ['/project-assets/cat.png'],
  }
  const s = toSheet(camel)
  assert.equal(s.lookCn, '白色小猫')
  assert.equal(s.lookEn, 'a small white kitten')
  assert.equal(s.palette, '白 + 灰')
  assert.deepEqual(s.keywords, ['猫'])
  assert.equal(s.voiceId, 'cartoon_pig')
  assert.deepEqual(s.referenceImages, ['/project-assets/cat.png'])
})

// ---- 3. 缺字段不抛错 ----
check('只有名字的角色不抛错', () => {
  const s = toSheet({ name: '幼猫' })
  assert.equal(s.id, '幼猫')
  assert.equal(s.lookCn, '')
  assert.equal(s.lookEn, '')
  assert.deepEqual(s.keywords, [])
  assert.equal(s.voiceId, undefined)
})

check('空对象不抛错且 id 有兜底', () => {
  const s = toSheet({})
  assert.equal(s.id, 'char')
  assert.equal(s.name, '')
  assert.equal(s.role, '')
})

check('形如 null 的脏数据不抛错', () => {
  // 历史库里出现过 name 为空、只有图的角色卡
  const s = toSheet({ name: '', image: '/project-assets/x.png' })
  assert.equal(s.id, 'char')
  assert.equal(s.image, '/project-assets/x.png')
})

// ---- 4. 读写往返 ----
check('toProject(toSheet(x)) 保持蛇形字段', () => {
  const back = toProject(toSheet(snake))
  assert.equal(back.look_cn, snake.look_cn)
  assert.equal(back.look_en, snake.look_en)
  assert.equal(back.palette, snake.palette)
  assert.deepEqual(back.keywords, snake.keywords)
  assert.equal(back.name, snake.name)
  assert.equal(back.voice, 'male-qn-badao')
})

check('驼峰往返不丢锚点', () => {
  const camel: CharacterSheet = {
    id: '验收',
    name: '验收',
    role: '',
    lookCn: '中文锚点',
    lookEn: 'english anchor',
    palette: '灰',
    keywords: ['k'],
  }
  const back = toProject(camel)
  assert.equal(back.look_cn, '中文锚点')
  assert.equal(back.look_en, 'english anchor')
})

// ---- 5. 读入口 ----
check('readCharacters 只吃对象且保持顺序', () => {
  const list = readCharacters([snake, { name: '小白', look_en: 'white kitten' }, null, 'x', 3])
  assert.equal(list.length, 2)
  assert.equal(list[0].name, '陈默')
  assert.equal(list[1].lookEn, 'white kitten')
})

check('readCharacters 非数组入参返回空数组', () => {
  assert.deepEqual(readCharacters(undefined), [])
  assert.deepEqual(readCharacters({ name: 'x' }), [])
})

// ---- 6. 混合形状：蛇形优先，空串时回退驼峰 ----
check('蛇形锚点非空时不回退驼峰', () => {
  const s = toSheet({ name: 'a', look_en: 'snake wins', lookEn: 'camel loses' } as never)
  assert.equal(s.lookEn, 'snake wins')
})

check('蛇形锚点为空串时回退驼峰', () => {
  const s = toSheet({ name: 'a', look_en: '', lookEn: 'camel fallback' } as never)
  assert.equal(s.lookEn, 'camel fallback')
})

// ---- 7. 写入前契约自检 ----
await checkAsync('合法蛇形 payload 通过自检', async () => {
  const merged = [toSheet(snake)]
  const payload = merged.map(toProject)
  assert.equal(checkCharacterWriteback(payload, merged), null)
})

await checkAsync('驼峰 payload 被自检拒绝', async () => {
  const merged = [toSheet(snake)]
  const camelPayload = [{ ...merged[0] }]
  const why = checkCharacterWriteback(camelPayload, merged)
  assert.ok(why, '驼峰 payload 必须被拒')
  assert.match(String(why), /lookEn|蛇形/)
})

await checkAsync('锚点被清空的 payload 被自检拒绝', async () => {
  const merged = [toSheet(snake)]
  const payload = merged.map(toProject)
  payload[0] = { ...payload[0], look_en: '' }
  const why = checkCharacterWriteback(payload, merged)
  assert.ok(why)
  assert.match(String(why), /未保存/)
})

await checkAsync('没有名字的角色被自检拒绝', async () => {
  const merged = [toSheet({ name: '甲', look_en: 'x' })]
  const payload = merged.map(toProject)
  payload[0] = { ...payload[0], name: '  ' }
  const why = checkCharacterWriteback(payload, merged)
  assert.ok(why)
  assert.match(String(why), /角色名/)
})

// ---- 8. 提交写回：快照是蛇形，落库也是蛇形 ----
function projectWith(characters: unknown[]): ProjectData {
  return { name: 'shape', characters, shots: [], episodes: [], designs: [], assets: [] } as unknown as ProjectData
}

await checkAsync('同名角色命中不崩，锚点原样保留', async () => {
  // 复现线上崩溃：快照是蛇形，提交同名角色，旧代码在 old.lookEn.trim() 处抛错
  let snap = projectWith([snake])
  const writer: { patches: unknown[] } = { patches: [] }
  const ctx: ProjectDraftCtx = {
    projectName: 'shape',
    epNo: 1,
    getSnapshot: () => snap,
    setSnapshot: (p) => {
      snap = p
    },
    writer: {
      patch: async (_n, patch) => {
        writer.patches.push(patch)
      },
    },
  }
  const r = await applyProjectDraft(
    'characters-v1',
    { characters: [{ name: '陈默', look_en: 'changed anchor' }] },
    ctx,
  )
  assert.equal(r.ok, true, r.ok ? '' : r.error)
  assert.equal(writer.patches.length, 1)
  const written = (writer.patches[0] as { characters: ProjectChar[] }).characters
  assert.equal(written.length, 1)
  assert.equal(written[0].look_en, snake.look_en, '没有 update 声明时不得覆盖已有锚点')
  assert.equal(written[0].look_cn, snake.look_cn)
  assert.ok(!('lookEn' in written[0]), '落库内容必须是蛇形')
})

await checkAsync('新增角色落库保留中英文锚点', async () => {
  let snap = projectWith([snake])
  const writer: { patches: unknown[] } = { patches: [] }
  const ctx: ProjectDraftCtx = {
    projectName: 'shape',
    epNo: 1,
    getSnapshot: () => snap,
    setSnapshot: (p) => {
      snap = p
    },
    writer: {
      patch: async (_n, patch) => {
        writer.patches.push(patch)
      },
    },
  }
  const r = await applyProjectDraft(
    'characters-v1',
    { characters: [{ name: '幼猫', look_cn: '白色幼猫', look_en: 'a small white kitten' }] },
    ctx,
  )
  assert.equal(r.ok, true, r.ok ? '' : r.error)
  const written = (writer.patches[0] as { characters: ProjectChar[] }).characters
  const cat = written.find((c) => c.name === '幼猫')
  assert.ok(cat, '新增角色必须写进落库内容')
  assert.equal(cat?.look_cn, '白色幼猫', '中文锚点必须保留')
  assert.equal(cat?.look_en, 'a small white kitten', '英文锚点必须保留')
  // 快照与落库同形状：都是蛇形
  const snapChars = snap.characters as ProjectChar[]
  assert.equal(snapChars.find((c) => c.name === '幼猫')?.look_en, 'a small white kitten')
  assert.ok(!('lookEn' in (snapChars[1] as object)), '快照不得混入驼峰')
})

await checkAsync('摘要包含写入的角色名', async () => {
  let snap = projectWith([])
  const ctx: ProjectDraftCtx = {
    projectName: 'shape',
    epNo: 1,
    getSnapshot: () => snap,
    setSnapshot: (p) => {
      snap = p
    },
    writer: { patch: async () => {} },
  }
  const r = await applyProjectDraft(
    'characters-v1',
    { characters: [{ name: '小白', look_en: 'white kitten' }] },
    ctx,
  )
  assert.equal(r.ok, true, r.ok ? '' : r.error)
  assert.match(r.summary, /小白/)
  assert.match(r.summary, /新增 1/)
})

// ---- 9. 合并阶段对缺失字段防御 ----
await checkAsync('已有角色缺 lookEn 字段不抛错且能补写', async () => {
  // 复现线上崩溃的直接输入：存量对象只有 name，没有 lookEn
  const cur = [toSheet({ name: '幼猫' })]
  const merged = mergeCharacters(cur, [{ name: '幼猫', look_en: 'a kitten' }])
  assert.deepEqual(merged.filled, ['幼猫'])
  assert.deepEqual(merged.skipped, [])
  assert.equal(merged.next[0].lookEn, 'a kitten')
})

await checkAsync('已有锚点的角色被跳过而不是覆盖', async () => {
  const cur = [toSheet(snake)]
  const merged = mergeCharacters(cur, [{ name: '陈默', look_en: 'new anchor' }])
  assert.deepEqual(merged.skipped, ['陈默'])
  assert.equal(merged.next[0].lookEn, snake.look_en)
})

// ---- 10. 提示词锚点展开 ----
await checkAsync('蛇形角色的锚点能展开，不留未解析占位符', async () => {
  let snap = {
    name: 'shape',
    characters: [snake],
    shots: [{ id: 'E01-S01', episode: 1, no: 'S01' }],
    episodes: [],
    designs: [],
    assets: [],
  } as unknown as ProjectData
  const ctx: ProjectDraftCtx = {
    projectName: 'shape',
    epNo: 1,
    getSnapshot: () => snap,
    setSnapshot: (p) => {
      snap = p
    },
    writer: { patch: async () => {}, mergeShots: async () => {} },
  }
  const r = await applyProjectDraft(
    'prompts-v1',
    { shots: [{ no: 'S01', keyframe_prompt: '{{陈默}} 站在雨里', video_prompt: 'push in' }] },
    ctx,
  )
  assert.equal(r.ok, true, r.ok ? '' : r.error)
  assert.equal(r.counts?.unresolved, 0, `不该有未解析锚点：${r.summary}`)
  const shot = (snap.shots as { keyframe_prompt?: string }[])[0]
  assert.ok(shot.keyframe_prompt?.includes(snake.look_en as string), '锚点必须被替换成英文锚点')
})

// ---- 11. 角色图片落库通道 ----
await checkAsync('带锚点的蛇形角色不被判「没有英文外观锚点」', async () => {
  let snap = projectWith([snake])
  const requested: { prompt: string }[] = []
  let committed: ProjectChar[] = []
  const tools = createMaterialTools({
    projectName: () => 'shape',
    epNo: () => 1,
    load: async () => snap,
    setSnapshot: (p) => {
      snap = p
    },
    writeShot: async () => ({ ok: true }),
    askCost: async () => ({ ok: true }),
    commitCharacters: (next) => {
      committed = next
    },
    io: {
      generateImage: async (input) => {
        requested.push({ prompt: input.prompt })
        return { urls: ['/generated/view-1.jpg'], url: '/generated/view-1.jpg' }
      },
    },
  })
  const byName = new Map(tools.map((t) => [t.name, t]))
  const r = await byName.get('generate_character_views')?.invoke({ character: '陈默' })
  assert.equal(r?.ok, true, r?.error as string)
  assert.equal(requested.length > 0, true, '必须真的走生图，而不是报缺锚点')
  assert.ok(requested[0].prompt.includes(String(snake.look_en)))
})

await checkAsync('角色图片落库用蛇形，且不动其它角色锚点', async () => {
  const other: ProjectChar = {
    name: '小白',
    look_cn: '白色小猫',
    look_en: 'a small white kitten',
    reference_images: ['/project-assets/cat.png'],
  }
  let snap = projectWith([snake, other])
  let committed: ProjectChar[] = []
  const tools = createMaterialTools({
    projectName: () => 'shape',
    epNo: () => 1,
    load: async () => snap,
    setSnapshot: (p) => {
      snap = p
    },
    writeShot: async () => ({ ok: true }),
    commitCharacters: (next) => {
      committed = next
    },
    io: { mediaUrls: async () => ['/project-assets/chenmo-2.png'] },
  })
  const byName = new Map(tools.map((t) => [t.name, t]))
  const r = await byName
    .get('set_character_visual')
    ?.invoke({ character: '陈默', target: 'image', url: '/project-assets/chenmo-2.png' })
  assert.equal(r?.ok, true, r?.error as string)
  const chenmo = committed.find((c) => c.name === '陈默')
  assert.equal(chenmo?.look_en, snake.look_en, '落库内容必须保留英文锚点')
  assert.equal(chenmo?.look_cn, snake.look_cn, '落库内容必须保留中文锚点')
  const cat = committed.find((c) => c.name === '小白')
  assert.equal(cat?.look_en, other.look_en, '未改动角色的锚点不得丢失')
  assert.deepEqual(cat?.reference_images, other.reference_images, '未改动角色的参考图不得丢失')
})

// ---- 12. 配音取角色音色 ----
await checkAsync('蛇形角色的 voice 被解析成音色 id', async () => {
  let snap = {
    name: 'shape',
    characters: [snake],
    shots: [{ id: 'E01-S01', episode: 1, no: 'S01', dialogue: '陈默：验收台词' }],
    episodes: [],
    designs: [],
    assets: [],
  } as unknown as ProjectData
  const calls: { url: string; init?: RequestInit }[] = []
  const prev = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const body = url.includes('/api/voice')
      ? { ok: true, url: '/audio/s01.mp3', engine: 'tts-x', seconds: 2.1, elapsed: 1 }
      : { ok: true }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  }) as typeof fetch
  try {
    const tools = createBuiltinPlatformTools({
      projectName: 'shape',
      epNo: 1,
      getSnapshot: () => snap,
      setSnapshot: (p) => {
        snap = p as typeof snap
      },
      askCost: async () => true,
    })
    const r = await tools.find((t) => t.name === 'generate_voice')?.invoke({ no: 'S01' })
    assert.equal(r?.ok, true, r?.error as string)
    const body = JSON.parse(String(calls.find((c) => c.url.includes('/api/voice'))?.init?.body))
    assert.equal(body.voice, 'male-qn-badao', '角色绑定的音色必须生效')
  } finally {
    globalThis.fetch = prev
  }
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
if (bad) process.exitCode = 1
