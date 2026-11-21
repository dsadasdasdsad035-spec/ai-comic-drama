/**
 * 视频提示词审计的写回门禁验收（4.1–4.5）。
 *
 * 直接调用平台写回入口 `applyProjectDraft`，用内存快照 + 注入 writer，
 * 断言：硬项阻断不落库、只有 warn 时放行、回执带 checks/hint、拒绝后原值不变、
 * 按 hint 重写后可成功提交。
 *
 * 跑法：node verify-video-prompt-audit-write.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
// 产物必须落在仓库内：/tmp 下解析不到 node_modules
const tmp = fs.mkdtempSync(path.join(ROOT, '.verify-vpa-write-'))
const out = path.join(tmp, 'entry.mjs')

fs.writeFileSync(
  path.join(tmp, 'entry.ts'),
  `
import { applyProjectDraft } from ${JSON.stringify(path.join(ROOT, 'src/platform/projectDraft.ts'))}
export { applyProjectDraft }
`,
)

execFileSync(
  ESBUILD,
  [path.join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=esm', '--packages=external', '--alias:@=./src', '--log-level=error', `--outfile=${out}`],
  { cwd: ROOT, stdio: 'inherit' },
)

const { applyProjectDraft } = await import(out)

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 造一份最小项目快照 */
function makeProject() {
  return {
    episodes: [
      {
        no: 1,
        title: '第一集',
        scenes: [
          { no: 1, slug: 'EP001-SC001', place: '咖啡厅', time: '夜', beats: '暴雨。更鼓敲过三响。' },
          { no: 2, slug: 'EP001-SC002', place: '后巷', time: '夜', beats: '两人对坐。' },
        ],
      },
    ],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        seconds: 4,
        size: '中景',
        move: '固定',
        desc: '雨夜推门',
        scene_no: 1,
        scene_slug: 'EP001-SC001',
        video_prompt: '旧正文',
        dialogue: [{ speaker: '林一', text: '你来了' }],
        cast: ['林一'],
        refIds: ['char-林一'],
      },
      {
        id: 'E01-S02',
        episode: 1,
        no: 'S02',
        seconds: 4,
        size: '中景',
        move: '固定',
        desc: '后巷对视',
        scene_no: 2,
        scene_slug: 'EP001-SC002',
        video_prompt: '旧正文二',
        dialogue: [],
        cast: [],
        refIds: [],
      },
    ],
    characters: [
      { name: '林一', look_en: 'short black hair, white shirt', role: '主角' },
    ],
    assets: [],
  }
}

/** 内存写回：记录是否真的落库 */
function makeCtx(project) {
  const writes = []
  return {
    writes,
    ctx: {
      projectName: 'demo',
      epNo: 1,
      getSnapshot: () => project,
      setSnapshot: (p) => Object.assign(project, p),
      writer: {
        mergeShots: async (name, shots) => {
          writes.push(shots)
        },
        patch: async () => {
          writes.push('patch')
        },
      },
    },
  }
}

const goodText =
  '中景构图，机位保持固定。林一 short black hair, white shirt 站在画左，' +
  '右手推开木门走进来，雨声与雷声持续，嘴唇开合低声说「你来了」，' +
  '最终她停在门边，右手扶住门框，半张脸留在光里。'

/* ---------------- 4.1 硬项阻断 ---------------- */
{
  const project = makeProject()
  const { writes, ctx } = makeCtx(project)
  const res = await applyProjectDraft('prompts-v1', {
    shots: [{ no: 'S01', keyframe_prompt: 'k', video_prompt: '画面' }],
  }, ctx)
  unit('4.1 占位正文被拒绝', res.ok === false, String(res.error || ''))
  unit('4.1 拒绝后未落库', writes.length === 0, `writes=${writes.length}`)
  unit('4.1 原字段未改', project.shots[0].video_prompt === '旧正文', project.shots[0].video_prompt)
}

/* ---------------- 4.2 回执形状 ---------------- */
{
  const project = makeProject()
  const { ctx } = makeCtx(project)
  const res = await applyProjectDraft('prompts-v1', {
    shots: [{ no: 'S01', keyframe_prompt: 'k', video_prompt: '画面' }],
  }, ctx)
  const checks = res.checks || []
  unit('4.2 回执带 checks', checks.length > 0, String(checks.length))
  unit(
    '4.2 每项含必备字段',
    checks.every((c) => 'id' in c && 'level' in c && 'applicable' in c && 'ok' in c),
    JSON.stringify(checks[0] || {}),
  )
  unit('4.2 失败项带 evidence', checks.every((c) => typeof c.evidence === 'string' && c.evidence.length > 0))
  unit('4.2 失败项带 hint', checks.every((c) => typeof c.hint === 'string' && c.hint.length > 0))
  unit('4.2 回执带整体 hint', typeof res.hint === 'string' && res.hint.length > 0)
  unit('4.2 每项标了镜号', checks.every((c) => c.no === 'S01'), JSON.stringify(checks.map((c) => c.no)))
}

/* ---------------- 4.3 只有 warn 时放行 ---------------- */
{
  // 第二镜 desc 无天气、无台词、cast 空 → 只有 ending-state 之类 warn
  const project = makeProject()
  const { writes, ctx } = makeCtx(project)
  const res = await applyProjectDraft('prompts-v1', {
    shots: [
      {
        no: 'S02',
        keyframe_prompt: 'k',
        video_prompt: '中景构图，机位保持固定。她推开木门走进来。',
      },
    ],
  }, ctx)
  unit('4.3 仅 warn 时写回成功', res.ok === true, String(res.error || res.summary))
  unit('4.3 确实落库了', writes.length > 0, `writes=${writes.length}`)
}

/* ---------------- 4.4 合规正文通过 ---------------- */
{
  const project = makeProject()
  const { writes, ctx } = makeCtx(project)
  const res = await applyProjectDraft('prompts-v1', {
    shots: [{ no: 'S01', keyframe_prompt: 'k', video_prompt: goodText }],
  }, ctx)
  unit('4.4 合规正文通过', res.ok === true, String(res.error || res.summary))
  unit('4.4 合规正文落库', writes.length > 0)
}

/* ---------------- 4.5 按 hint 重写后可提交 ---------------- */
{
  const project = makeProject()
  const { writes, ctx } = makeCtx(project)
  const first = await applyProjectDraft('prompts-v1', {
    shots: [{ no: 'S01', keyframe_prompt: 'k', video_prompt: '画面' }],
  }, ctx)
  unit('4.5 第一次被拒', first.ok === false && writes.length === 0)
  const ids = (first.checks || []).map((c) => c.id)
  unit('4.5 清单可读', ids.length > 0, ids.join(','))

  const second = await applyProjectDraft('prompts-v1', {
    shots: [{ no: 'S01', keyframe_prompt: 'k', video_prompt: goodText }],
  }, ctx)
  unit('4.5 重写后通过', second.ok === true, String(second.error || second.summary))
  unit('4.5 重写后落库', writes.length > 0)
}

/* ---------------- 空/未涉及镜头不阻断 ---------------- */
{
  const project = makeProject()
  const { ctx } = makeCtx(project)
  const res = await applyProjectDraft('prompts-v1', {
    shots: [
      {
        no: 'S02',
        keyframe_prompt: 'k',
        video_prompt: '中景，机位固定，她推开门走进来，最终停在门边。',
      },
    ],
  }, ctx)
  unit('无台词无环境事实的镜头无 blocker', res.ok === true, String(res.error || ''))
}

console.log(bad ? `\nverify-video-prompt-audit-write: ${bad} failed` : '\nverify-video-prompt-audit-write: all green')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
