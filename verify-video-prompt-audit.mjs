/**
 * 视频提示词审计核的纯函数验收。
 *
 * 断言 25 个审计项（23 主项 + 1 辅助项 cast-anchor-unknown + 注册表本身）的
 * `applicable` / `ok` / `level` 语义，重点是「本镜不涉及」与「涉及但没写」的区分。
 *
 * 跑法：node verify-video-prompt-audit.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-vpa-'))
const out = path.join(tmp, 'entry.mjs')

fs.writeFileSync(
  path.join(tmp, 'entry.ts'),
  `
import { auditVideoPromptCore, VIDEO_AUDIT_CHECK_IDS } from ${JSON.stringify(path.join(ROOT, 'src/promptAuditCore.mjs'))}
import { AUDIT_VOCAB } from ${JSON.stringify(path.join(ROOT, 'src/videoPromptVocab.ts'))}
export { auditVideoPromptCore, VIDEO_AUDIT_CHECK_IDS, AUDIT_VOCAB }
`,
)

execFileSync(
  ESBUILD,
  [path.join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=esm', '--packages=external', '--log-level=error', `--outfile=${out}`],
  { cwd: ROOT, stdio: 'inherit' },
)

const { auditVideoPromptCore, VIDEO_AUDIT_CHECK_IDS, AUDIT_VOCAB } = await import(out)

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 取单项结果 */
const one = (shot, ctx, id) => auditVideoPromptCore(shot, { vocab: AUDIT_VOCAB, ...ctx }).checks.find((c) => c.id === id)
const audit = (shot, ctx = {}) => auditVideoPromptCore(shot, { vocab: AUDIT_VOCAB, ...ctx })

const fullText =
  '中景构图，机位保持固定。她站在画左，右手抬起推开木门，雨声与雷声持续，' +
  '嘴唇开合低声说「你终于来了」，最终她停在门边，右手扶住门框，半张脸留在光里。'

const baseShot = {
  no: 'S01',
  size: '中景',
  move: '固定',
  seconds: 4,
  desc: '雨夜推门',
  video_prompt: fullText,
  cast: [],
  dialogue: [],
  scene_slug: 'EP001-SC001',
}

/* ---------------- 1. 注册表 ---------------- */
unit('注册表 id 数 = 25', VIDEO_AUDIT_CHECK_IDS.length === 25, String(VIDEO_AUDIT_CHECK_IDS.length))
unit('注册表无重复', new Set(VIDEO_AUDIT_CHECK_IDS).size === VIDEO_AUDIT_CHECK_IDS.length)
{
  const ids = audit(baseShot).checks.map((c) => c.id)
  const missing = VIDEO_AUDIT_CHECK_IDS.filter((id) => !ids.includes(id))
  unit('审计输出覆盖全部注册项', missing.length === 0, missing.join(','))
}

/* ---------------- 2. A 结构完整性 ---------------- */
unit('size-declared 通过', one(baseShot, {}, 'size-declared').ok === true)
unit(
  'size-declared 缺景别报 error',
  (() => {
    const r = one({ ...baseShot, video_prompt: '她推开门走进来' }, {}, 'size-declared')
    return r.ok === false && r.level === 'error'
  })(),
)
unit(
  'size-declared 无 size 时不适用',
  one({ ...baseShot, size: '', video_prompt: '随便写写' }, {}, 'size-declared').applicable === false,
)
unit('move-declared 固定机位不误报', one(baseShot, {}, 'move-declared').ok === true)
unit(
  'move-declared 移动运镜缺词报错',
  (() => {
    const r = one({ ...baseShot, move: '推', video_prompt: '她走进来，停在门边' }, {}, 'move-declared')
    return r.ok === false && r.level === 'error'
  })(),
)
unit(
  'action-chain 纯氛围判否',
  (() => {
    const r = one({ ...baseShot, video_prompt: '雨夜，昏黄的灯笼在风里摇晃，空气潮湿。' }, {}, 'action-chain')
    return r.ok === false && r.level === 'error'
  })(),
)
unit('action-chain 有动作通过', one(baseShot, {}, 'action-chain').ok === true)
unit(
  'placeholder-free 抓占位',
  (() => {
    const r = one({ ...baseShot, video_prompt: '与动作结束状态一致' }, {}, 'placeholder-free')
    return r.ok === false && r.evidence.includes('与动作结束状态一致')
  })(),
)
unit('placeholder-free 干净正文通过', one(baseShot, {}, 'placeholder-free').ok === true)

/* ---------------- 3. B 结尾衔接 ---------------- */
unit('ending-state 有终点通过', one(baseShot, {}, 'ending-state').ok === true)
unit(
  'ending-state 无终点报 warn',
  (() => {
    const r = one({ ...baseShot, video_prompt: '中景，机位固定，她推开门走了出去' }, {}, 'ending-state')
    return r.ok === false && r.level === 'warn'
  })(),
)
unit(
  'handoff-consistency 末镜不适用',
  one(baseShot, { isLastShot: true }, 'handoff-consistency').applicable === false,
)
unit(
  'handoff-consistency 持物矛盾报 warn',
  (() => {
    const r = one(
      { ...baseShot, video_prompt: '中景，机位固定，她撑着伞走进来，最终停在门边' },
      { nextShot: { video_prompt: '双手空着站在原地' } },
      'handoff-consistency',
    )
    return r.ok === false && r.level === 'warn' && r.evidence.includes('伞')
  })(),
)

/* ---------------- 4. C 表演与声音 ---------------- */
unit('lip-sync 无台词不适用', one({ ...baseShot, dialogue: [] }, {}, 'lip-sync').applicable === false)
unit(
  'lip-sync 有台词无口型报 error',
  (() => {
    const r = one(
      { ...baseShot, video_prompt: '中景，机位固定，她推开门', dialogue: [{ speaker: '林一', text: '你来了' }] },
      {},
      'lip-sync',
    )
    return r.ok === false && r.level === 'error'
  })(),
)
unit(
  'lip-sync 有台词有口型通过',
  (() => {
    const r = one(
      { ...baseShot, dialogue: [{ speaker: '林一', text: '你来了' }] },
      {},
      'lip-sync',
    )
    return r.ok === true && r.applicable === true
  })(),
)
unit(
  'voice-consistent 音色指向非说话人报 error',
  (() => {
    const r = one(
      {
        ...baseShot,
        audio_mode: 'native',
        audio_ref: { character: '张三', url: '/a.mp3' },
        dialogue: [{ speaker: '林一', text: '你来了' }],
      },
      {},
      'voice-consistent',
    )
    return r.ok === false && r.level === 'error'
  })(),
)
unit(
  'audio-ready 有台词无配音报 warn',
  (() => {
    const r = one(
      { ...baseShot, dialogue: [{ speaker: '林一', text: '你来了' }], clip: '' },
      {},
      'audio-ready',
    )
    return r.ok === false && r.level === 'warn'
  })(),
)
unit(
  'ambient-sound 剧本有雨正文无声报 error',
  (() => {
    const r = one(
      { ...baseShot, video_prompt: '中景，机位固定，她推开门', desc: '雨夜推门' },
      { sceneBeats: '暴雨。更鼓敲过三响' },
      'ambient-sound',
    )
    return r.ok === false && r.level === 'error'
  })(),
)
unit(
  'ambient-sound 无环境事实不适用',
  one({ ...baseShot, video_prompt: '中景，机位固定，她推开门', desc: '室内对话' }, { sceneBeats: '两人对坐' }, 'ambient-sound')
    .applicable === false,
)
unit(
  'perf-diversity 多人共用情绪报 warn',
  (() => {
    const r = one(
      {
        ...baseShot,
        cast: ['林一', '张三'],
        video_prompt: '中景，机位固定，林一震惊地看着门口，张三震惊地后退，最终两人停在原地',
      },
      {},
      'perf-diversity',
    )
    return r.ok === false && r.level === 'warn'
  })(),
)

/* ---------------- 5. D 参考一致性 ---------------- */
unit(
  'cast-anchor 缺锚点报 error',
  (() => {
    const r = one(
      { ...baseShot, cast: ['林一'] },
      { chars: [{ name: '林一', lookEn: 'short black hair, white shirt' }] },
      'cast-anchor',
    )
    return r.ok === false && r.level === 'error'
  })(),
)
unit(
  'cast-anchor 有锚点通过',
  (() => {
    const r = one(
      { ...baseShot, video_prompt: `${fullText} 林一 short black hair, white shirt` , cast: ['林一'] },
      { chars: [{ name: '林一', lookEn: 'short black hair, white shirt' }] },
      'cast-anchor',
    )
    return r.ok === true
  })(),
)
unit('cast-anchor cast 为空不适用', one(baseShot, {}, 'cast-anchor').applicable === false)
unit(
  'ref-described 挂图未说明报 warn',
  (() => {
    const r = one(
      { ...baseShot, video_prompt: '中景，机位固定，她推开门停下' },
      { refs: [{ kind: 'character', name: '林一' }] },
      'ref-described',
    )
    return r.ok === false && r.level === 'warn'
  })(),
)
unit(
  'mode-matched 声称参考但无参考图报 error',
  (() => {
    const r = one(
      { ...baseShot, video_prompt: '参考首帧，机位固定，她推开门最终停下' },
      { refs: [] },
      'mode-matched',
    )
    return r.ok === false && r.level === 'error'
  })(),
)
unit(
  'mode-matched 自足描写且无参考通过',
  one({ ...baseShot, video_prompt: '中景，机位固定，她推开门最终停在门边' }, { refs: [] }, 'mode-matched').ok === true,
)

/* ---------------- 6. E 生成风险 ---------------- */
unit(
  'duration-fit 分段合计不符报 warn',
  (() => {
    const r = one(
      { ...baseShot, seconds: 5, video_prompt: '0.0-1.5s 她推门；1.5-3.0s 她走进来，最终停在门边，中景，机位固定' },
      {},
      'duration-fit',
    )
    return r.ok === false && r.level === 'warn' && r.evidence.includes('3.0s')
  })(),
)
unit(
  'duration-fit 合计相符通过',
  one(
    { ...baseShot, seconds: 3, video_prompt: '0.0-1.5s 推门；1.5-3.0s 走入，最终停在门边，中景固定' },
    {},
    'duration-fit',
  ).ok === true,
)
unit(
  'camera-conflict 同时段固定与移动报 warn',
  (() => {
    const r = one(
      { ...baseShot, video_prompt: '0.0-2.0s 固定机位；1.0-4.0s 镜头推近，最终停住，中景' },
      {},
      'camera-conflict',
    )
    return r.ok === false && r.level === 'warn'
  })(),
)
unit(
  'multi-person-blocking 多人无站位报 warn',
  (() => {
    const r = one(
      { ...baseShot, cast: ['林一', '张三'], video_prompt: '中景固定，林一抬手指向远处，张三低头，最终停住' },
      {},
      'multi-person-blocking',
    )
    return r.ok === false && r.level === 'warn'
  })(),
)
unit(
  'fight-rounds 打戏无分段报 warn',
  (() => {
    const r = one(
      { ...baseShot, desc: '两人对峙出拳', video_prompt: '中景固定，他抡拳打向对方，最终两人停住' },
      {},
      'fight-rounds',
    )
    return r.ok === false && r.level === 'warn'
  })(),
)
unit(
  'text-risk 有招牌无文字说明报 warn',
  (() => {
    const r = one(
      { ...baseShot, desc: '街口招牌', video_prompt: '中景固定，她抬头看着招牌，最终停住' },
      {},
      'text-risk',
    )
    return r.ok === false && r.level === 'warn'
  })(),
)
unit(
  'physically-risky 精细手指无化解报 warn',
  (() => {
    const r = one(
      { ...baseShot, video_prompt: '特写固定，他用指尖穿针，最终停住' },
      {},
      'physically-risky',
    )
    return r.ok === false && r.level === 'warn'
  })(),
)
unit(
  'dialogue-fidelity 编造台词报 error',
  (() => {
    const r = one(
      { ...baseShot },
      { dialogueSource: '你来了' },
      'dialogue-fidelity',
    )
    return r.ok === false && r.level === 'error' && r.evidence.includes('你终于来了')
  })(),
)
unit(
  'dialogue-fidelity 引文在定稿内通过',
  (() => {
    const r = one({ ...baseShot }, { dialogueSource: '你终于来了' }, 'dialogue-fidelity')
    return r.ok === true
  })(),
)

/* ---------------- 7. 阻断语义 ---------------- */
{
  // desc 写了「雨夜」，正文必须带环境声，否则 ambient-sound 正确地报 error
  const clean = audit({
    ...baseShot,
    video_prompt: '中景构图，机位保持固定。她推开门走进来，雨声持续，最终停在门边。',
  })
  unit('干净正文无 blocker', clean.blockers.length === 0, JSON.stringify(clean.blockers.map((b) => b.id)))

  const dirty = audit({ ...baseShot, video_prompt: '画面' })
  unit('占位正文有 blocker', dirty.blockers.length > 0, dirty.blockers.map((b) => b.id).join(','))
  unit(
    'blocker 全为 applicable && !ok && error',
    dirty.blockers.every((b) => b.applicable && !b.ok && b.level === 'error'),
  )
  unit('warnings 全为 warn', dirty.warnings.every((w) => w.level === 'warn' && w.applicable && !w.ok))
  unit(
    '不适用项不进 blockers/warnings',
    [...dirty.blockers, ...dirty.warnings].every((x) => x.applicable === true),
  )
}

/* ---------------- 8. 不适用不阻断 ---------------- */
{
  const noCtx = audit({
    no: 'S01',
    size: '',
    move: '',
    seconds: 4,
    desc: '',
    video_prompt: '她推开门走进来，最终停在门边。',
    cast: [],
    dialogue: [],
  })
  unit('全字段空的镜头无 blocker', noCtx.blockers.length === 0, noCtx.blockers.map((b) => b.id).join(','))
}

/* ---------------- 9. 不可变性 ---------------- */
{
  const shot = JSON.parse(JSON.stringify(baseShot))
  const before = JSON.stringify(shot)
  audit(shot)
  unit('审计无副作用', JSON.stringify(shot) === before)
}

console.log(bad ? `\nverify-video-prompt-audit: ${bad} failed` : '\nverify-video-prompt-audit: all green')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
