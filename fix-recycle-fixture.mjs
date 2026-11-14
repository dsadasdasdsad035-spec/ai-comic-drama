/**
 * 修复 recycle 夹具：把两条历史残片的镜号排到 S03/S04，消除「同集重复镜号」。
 *
 * 为什么要修：镜头 id 由 E{集}-{镜号} 生成（src/shotRows.ts 的 canonicalShotId），
 * 同集重复镜号会让两条镜头归一化成同一个 id，画布水合时产出两个同 id 节点，
 * React 按 key 去重后只剩一张卡。这是数据不满足不变量，不是代码 bug。
 *
 * 原始快照（修复前）保留在脚本里，便于回退。
 */
const base = process.env.SB_URL || 'http://127.0.0.1:5273'

const TARGET = 'recycle'

/** 修复前的原始 4 条镜头（用于回退：node fix-recycle-fixture.mjs --restore） */
const ORIGINAL = [
  {
    id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', move: '固定',
    desc: '废土夜市空镜', dialogue: [], cast: [], keyframe_prompt: '废土夜市空镜',
    keyframe: '', video_prompt: '', clip: '', handEdited: [], scene_no: 1,
    audio_mode: 'off', video_prompt_override: null, video_prompt_rendered: null,
    video_prompt_render_meta: null, refIds: [], transition_out: null, motion_note: '',
    use_expression_ref: false,
  },
  {
    id: 'E01-S02', episode: 1, no: 'S02', seconds: 3, size: '近景', move: '固定',
    desc: '旧义体特写', dialogue: [], cast: [], keyframe_prompt: '', keyframe: '',
    video_prompt: '', clip: '', handEdited: [], scene_no: 1, orphan: true,
  },
  {
    id: 'R1', episode: 1, no: 'S01', seconds: 3, size: '中景', move: '固定',
    desc: '', dialogue: '', cast: [], keyframe_prompt: '夜市推车',
    keyframe: '/generated/shot-1792653104009-fe6e05.jpg', video_prompt: '', clip: '',
    handEdited: [], prompt: '夜市推车', refIds: [], orphan: true,
  },
  {
    id: 'R2', episode: 1, no: 'S02', seconds: 3, size: '中景', move: '固定',
    desc: '', dialogue: '', cast: [], keyframe_prompt: '摊主推手臂',
    keyframe: '/generated/shot-1792635049165-29ec33.jpg', video_prompt: '', clip: '',
    handEdited: [], prompt: '摊主推手臂', refIds: [], orphan: true,
  },
]

/** 修复后：R1/R2 变为 E01-S03/E01-S04，镜号 S03/S04，其余字段原样 */
const FIXED = ORIGINAL.map((s) => {
  if (s.id === 'R1') return { ...s, id: 'E01-S03', no: 'S03' }
  if (s.id === 'R2') return { ...s, id: 'E01-S04', no: 'S04' }
  return s
})

const restore = process.argv.includes('--restore')
const shots = restore ? ORIGINAL : FIXED

const cur = await (await fetch(`${base}/api/project?name=${TARGET}`)).json()
const project = cur.project
const res = await fetch(`${base}/api/project?name=${TARGET}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project: { ...project, shots } }),
})
const out = await res.json()
console.log(res.status, out.ok, (restore ? '已回退' : '已修复'), shots.map((s) => `${s.id}/${s.no}`).join(', '))
