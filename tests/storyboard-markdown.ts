/**
 * 分镜表 Markdown 导出验收。
 *
 * 两条硬约束：
 * 1) 导出文件必须能被现有导入路径原样吃回去（单集、单表、首列镜号）；
 * 2) 单元格里的换行与竖线不能打断表格，且导入侧能还原分段。
 */
import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import {
  mdCell,
  mdFileName,
  exportZipName,
  renderShotRow,
  renderShotTable,
  SHOT_TABLE_HEADER,
  episodeMarkdown,
  allEpisodeMarkdowns,
  buildStoryboardZip,
} from '../src/storyboardMarkdown'
import { episodeScopeOf, hasShotTable } from '../src/intake/classify'
import { detectFormat, markdownTableBlocks, parseTable } from '../src/intake/format'
import { splitDialogueCell } from '../src/intake/normalize'
import { rowsFromTable } from '../src/intake/rows'
import { buildShotsFromImport } from '../src/agent/shotDraft'
import { mergeShotsDraft } from '../src/shotSync'
import type { ProjectEpisode, ProjectShot } from '../src/api'

const SHOT = {
  id: 'E01-S01',
  episode: 1,
  no: 'S01',
  scene_no: 1,
  seconds: 4,
  size: '中景',
  move: '推',
  desc: '雨夜街头，霓虹倒影',
  dialogue: [{ speaker: '陈默', text: '又是这里。' }],
  keyframe_prompt: 'rain-soaked street, neon reflection',
  video_prompt: 'slow push-in',
} as ProjectShot

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✅ ${name}`)
    })
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

async function main() {
  await check('单元格：换行写成 br，竖线换成全角', () => {
    assert.equal(mdCell('陈默：走吧。\n林小雨：等一下。'), '陈默：走吧。<br>林小雨：等一下。')
    assert.equal(mdCell('a|b'), 'a｜b')
    assert.equal(mdCell('第一行\r\n第二行'), '第一行<br>第二行')
  })

  await check('单元格：行尾空白不进入 br，内容不截断', () => {
    assert.equal(mdCell('甲  \n  乙'), '甲<br>乙')
    const long = '雨'.repeat(600)
    assert.equal(mdCell(long), long)
  })

  await check('单元格：空值与纯空白写成空串', () => {
    assert.equal(mdCell(undefined), '')
    assert.equal(mdCell(null), '')
    assert.equal(mdCell('   \n  '), '')
  })

  await check('文件名：集号补零，标题接在后面', () => {
    assert.equal(mdFileName(1, '雨夜'), 'E01-雨夜.md')
    assert.equal(mdFileName(12, '重逢'), 'E12-重逢.md')
  })

  await check('文件名：非法字符与空白转连字符，不留首尾连字符', () => {
    assert.equal(mdFileName(1, '雨夜 / 天台: 重逢?'), 'E01-雨夜-天台-重逢.md')
    assert.equal(mdFileName(1, '  留白  '), 'E01-留白.md')
  })

  await check('文件名：空标题退化为纯集号', () => {
    assert.equal(mdFileName(3), 'E03.md')
    assert.equal(mdFileName(3, '   '), 'E03.md')
    assert.equal(mdFileName(3, '///'), 'E03.md')
  })

  await check('zip 名：项目名净化，空项目名有兜底', () => {
    assert.equal(exportZipName('回收人'), '回收人-分镜表.zip')
    assert.equal(exportZipName('回收/人'), '回收-人-分镜表.zip')
    assert.equal(exportZipName(''), '分镜表.zip')
  })

  await check('表头：首列是镜头，列顺序固定', () => {
    assert.equal(SHOT_TABLE_HEADER[0], '镜头')
    assert.deepEqual(
      [...SHOT_TABLE_HEADER],
      [
        '镜头',
        '场次',
        '时长',
        '景别',
        '运镜',
        '画面与动作',
        '台词与声音',
        '首帧提示词',
        '视频提示词',
        '选角',
        '表演',
        '运镜参照',
        '参考',
      ],
    )
  })

  await check('行：每行列数与表头一致', () => {
    const row = renderShotRow(SHOT)
    const cells = row.split('|').slice(1, -1)
    assert.equal(cells.length, SHOT_TABLE_HEADER.length, row)
    assert.equal(cells[0].trim(), 'S01')
    assert.equal(cells[1].trim(), '1')
    assert.equal(cells[2].trim(), '4')
    assert.equal(cells[5].trim(), '雨夜街头，霓虹倒影')
    assert.equal(cells[7].trim(), 'rain-soaked street, neon reflection')
  })

  await check('行：只有首帧提示词时画面列留空，两列不互相填充', () => {
    const onlyPrompt = { ...SHOT, desc: undefined, dialogue: undefined, video_prompt: undefined } as ProjectShot
    const cells = renderShotRow(onlyPrompt).split('|').slice(1, -1).map((c) => c.trim())
    assert.equal(cells[5], '', '画面与动作必须留空')
    assert.equal(cells[6], '', '台词为空时留空')
    assert.equal(cells[7], 'rain-soaked street, neon reflection')
    assert.equal(cells[8], '')
  })

  await check('行：两列提示词都空时仍占位', () => {
    const bare = { ...SHOT, keyframe_prompt: undefined, video_prompt: undefined } as ProjectShot
    const cells = renderShotRow(bare).split('|').slice(1, -1).map((c) => c.trim())
    assert.equal(cells.length, SHOT_TABLE_HEADER.length)
    assert.equal(cells[7], '')
    assert.equal(cells[8], '')
  })

  await check('行：多行台词用 br 挤在一格里', () => {
    const two = {
      ...SHOT,
      dialogue: [
        { speaker: '陈默', text: '又是这里。' },
        { speaker: '林小雨', text: '你认得这条路？' },
      ],
    } as ProjectShot
    const cells = renderShotRow(two).split('|').slice(1, -1).map((c) => c.trim())
    assert.equal(cells[6], '陈默：又是这里。<br>林小雨：你认得这条路？')
    assert.equal(cells.length, SHOT_TABLE_HEADER.length)
  })

  await check('行：字符串形态的台词也能导出', () => {
    const legacy = { ...SHOT, dialogue: '陈默：又是这里。' } as ProjectShot
    const cells = renderShotRow(legacy).split('|').slice(1, -1).map((c) => c.trim())
    assert.equal(cells[6], '陈默：又是这里。')
  })

  await check('表：没有镜头时不产出空表', () => {
    assert.equal(renderShotTable([]), '')
    const table = renderShotTable([SHOT])
    assert.equal(table.split('\n').length, 3, '表头 + 分隔行 + 一行数据')
  })

  const EPISODES: ProjectEpisode[] = [
    {
      no: 1,
      title: '雨夜',
      hook: '旧照片里的人突然眨眼。',
      targetSeconds: 60,
      scenes: [
        { no: 1, slug: '天台', place: '天台', time: '夜', characters: ['陈默', '林小雨'], intensity: 7, tone: '压抑', beats: '陈默把照片举到路灯下。' },
        { no: 2, slug: '巷口', place: '巷口', time: '深夜', characters: ['陈默'], beats: '巷口空无一人。' },
      ],
    },
  ]
  const SHOTS: ProjectShot[] = [
    {
      ...SHOT,
      id: 'E01-S01',
      no: 'S01',
      transition_out: { to: 'E01-S02', mode: 'effect', effect: { type: 'dissolve', seconds: 0.6 } },
    } as ProjectShot,
    {
      ...SHOT,
      id: 'E01-S02',
      no: 'S02',
      scene_no: 2,
      desc: '巷口空无一人',
      dialogue: undefined,
      keyframe_prompt: undefined,
      transition_out: null,
    } as ProjectShot,
  ]
  const FIXED = { exportedAt: new Date('2026-11-15T04:00:00Z') }

  await check('单集：集边界唯一且被判为 single', () => {
    const md = episodeMarkdown({ projectName: '回收人', episodes: EPISODES, shots: SHOTS }, 1, FIXED)
    const scope = episodeScopeOf(md.text)
    assert.equal(scope.scope, 'single')
    assert.equal(scope.no, 1)
    assert.equal((md.text.match(/^#{1,6}\s*第\s*\d+\s*集/gm) ?? []).length, 1,
      '全文件只允许一个集级标题')
  })

  await check('单集：场次小节标题不带集标记', () => {
    const md = episodeMarkdown({ projectName: '回收人', episodes: EPISODES, shots: SHOTS }, 1, FIXED)
    assert.ok(md.text.includes('### 场 1 · 天台 · 夜'), md.text)
    assert.ok(md.text.includes('### 场 2 · 巷口 · 深夜'), md.text)
  })

  await check('单集：只含一张带镜号的分镜表', () => {
    const md = episodeMarkdown({ projectName: '回收人', episodes: EPISODES, shots: SHOTS }, 1, FIXED)
    assert.ok(hasShotTable(md.text), '首列表头必须可识别为镜号')
    const blocks = markdownTableBlocks(md.text)
    assert.equal(blocks.length, 1, '只允许一张表')
  })

  await check('单集：导出文件被识别为表格而不是自由文本', () => {
    const md = episodeMarkdown({ projectName: '回收人', episodes: EPISODES, shots: SHOTS }, 1, FIXED)
    // 导入对话框只看前 40 行；导出文件前面有标题与场次小节，必须按块找到分镜表
    assert.equal(detectFormat(md.text).kind, 'markdown-table')
    const rows = parseTable(md.text, 'markdown-table')
    assert.equal(rows[0][0], '镜头')
    assert.deepEqual(rows.slice(1).map((r) => r[0]), ['S01', 'S02'])
  })

  await check('格式识别：普通文档里的无关表格不冒充分镜表', () => {
    const doc = `# 说明

| 道具 | 数量 |
| --- | --- |
| 照片 | 3 |
`
    assert.equal(detectFormat(doc).kind, 'free-text')
  })

  await check('单集：集钩子、目标时长、镜数与总时长写在表格外', () => {
    const md = episodeMarkdown({ projectName: '回收人', episodes: EPISODES, shots: SHOTS }, 1, FIXED)
    assert.ok(md.text.includes('- 钩子：旧照片里的人突然眨眼。'))
    assert.ok(md.text.includes('2 镜 · 总时长 8s / 目标 60s'), md.text)
    assert.ok(md.text.includes('- 出场：陈默、林小雨'))
    assert.ok(md.text.includes('- 冲突 7 · 基调：压抑'))
    assert.ok(md.text.includes('- 剧情：陈默把照片举到路灯下。'))
  })

  await check('单集：转场与缺项写进附注', () => {
    const md = episodeMarkdown({ projectName: '回收人', episodes: EPISODES, shots: SHOTS }, 1, FIXED)
    assert.ok(md.text.includes('#### 附注'))
    assert.ok(md.text.includes('S01 → S02：dissolve 0.6s'), md.text)
    assert.ok(md.text.includes('缺首帧提示词：S02'), 'S02 没有首帧提示词')
  })

  await check('单集：集标题为空时标题行不带尾随空格', () => {
    const md = episodeMarkdown({ projectName: '回收人', episodes: [{ no: 2 }], shots: [] }, 2, FIXED)
    assert.ok(md.text.includes('\n## 第 2 集\n'), md.text)
    assert.equal(md.fileName, 'E02.md')
  })

  await check('单集：有镜头但没登记分集时仍能导出', () => {
    const md = episodeMarkdown({ projectName: '回收人', shots: SHOTS }, 1, FIXED)
    assert.equal(episodeScopeOf(md.text).scope, 'single')
    assert.ok(md.text.includes('| S01 |'), md.text)
  })

  await check('全部集：按集号升序，集内按镜号数字序', () => {
    const src = {
      projectName: '回收人',
      episodes: [
        { no: 3, title: '归途' },
        { no: 1, title: '雨夜' },
        { no: 2, title: '旧照片' },
      ],
      shots: [
        { ...SHOT, id: 'E02-S10', episode: 2, no: 'S10' },
        { ...SHOT, id: 'E02-S02', episode: 2, no: 'S02' },
        { ...SHOT, id: 'E01-S01', episode: 1, no: 'S01' },
        ...SHOTS,
      ] as ProjectShot[],
    }
    const docs = allEpisodeMarkdowns(src, FIXED)
    assert.deepEqual(docs.map((d) => d.epNo), [1, 2, 3])
    assert.deepEqual(docs.map((d) => d.fileName), ['E01-雨夜.md', 'E02-旧照片.md', 'E03-归途.md'])

    const ep2 = docs[1]
    assert.ok(!ep2.text.includes('S01 |'), '第 2 集不该混入第 1 集的镜头')
    const nos = ep2.text
      .split('\n')
      .filter((l) => l.startsWith('| S'))
      .map((l) => l.split('|')[1].trim())
    assert.deepEqual(nos, ['S02', 'S10'], '镜号按数字序，不是字典序')
    assert.equal(docs[2].text.includes('| S'), false, '第 3 集没有镜头')
  })

  await check('全部集：每份文件都判为各自的单集', () => {
    const docs = allEpisodeMarkdowns({ projectName: '回收人', episodes: EPISODES, shots: SHOTS }, FIXED)
    for (const doc of docs) {
      const scope = episodeScopeOf(doc.text)
      assert.equal(scope.scope, 'single')
      assert.equal(scope.no, doc.epNo)
    }
  })

  await check('台词单元格：br 还原成换行，两个说话人各一条', () => {
    const r = splitDialogueCell('陈默：又是这里。<br>林小雨：你认得这条路？')
    assert.deepEqual(r.lines, [
      { speaker: '陈默', text: '又是这里。' },
      { speaker: '林小雨', text: '你认得这条路？' },
    ])
    assert.equal(r.narrators.length, 0)
  })

  await check('台词单元格：br 的三种写法结果一致', () => {
    const a = splitDialogueCell('甲：一。<br>乙：二。')
    const b = splitDialogueCell('甲：一。<br/>乙：二。')
    const c = splitDialogueCell('甲：一。<BR />乙：二。')
    assert.deepEqual(a, b)
    assert.deepEqual(a, c)
  })

  await check('台词单元格：没有 br 的既有用法行为不变', () => {
    assert.deepEqual(splitDialogueCell('旁白：那天晚上，我以为自己活不过去了。').narrators, [
      { speaker: '旁白', text: '那天晚上，我以为自己活不过去了。' },
    ])
    const fx = splitDialogueCell('雨声、远处车声。')
    assert.equal(fx.lines.length, 0)
    assert.deepEqual(fx.sounds, ['雨声、远处车声。'])
    const mix = splitDialogueCell('脚步声停止。人类轻声：小家伙，你怎么在这里？')
    assert.equal(mix.lines.length, 1)
    assert.equal(mix.lines[0].speaker, '人类轻声')
    assert.equal(mix.sounds.length, 1)
  })

  const SCENE_TABLE = `| 镜头 | 场次 | 时长 | 画面与动作 |
| --- | --- | --- | --- |
| S01 | 1 | 3 | 天台 |
| S02 | 2 | 4 | 巷口 |`

  await check('场次列：对上已知场次时写进镜头', () => {
    const r = rowsFromTable(SCENE_TABLE, 'markdown-table', { epNo: 1, episodes: EPISODES })
    assert.equal(r.diff.scenesFallback, 0)
    assert.deepEqual(r.rows.map((x) => x.scene_no), [1, 2])
    assert.equal(r.diff.ignoredColumns.includes('场次'), false, '场次已被写入，不能再报「忽略」')
    assert.equal(r.headers.find((h) => h.header === '场次')?.column, 'scene_no')
    const built = buildShotsFromImport(
      r.rows.map((x) => ({ no: x.no, scene_no: x.scene_no, seconds: x.seconds, desc: x.desc })),
      EPISODES,
      1,
    )
    assert.equal(built.sceneFallback, 0)
    assert.equal(built.shots[1].scene_no, 2)
    assert.equal(built.shots[1].scene_slug, '巷口')
  })

  await check('场次列：对不上时留空并计入预览提示', () => {
    const table = SCENE_TABLE.replace('| S02 | 2 |', '| S02 | 9 |')
    const r = rowsFromTable(table, 'markdown-table', { epNo: 1, episodes: EPISODES })
    assert.equal(r.diff.scenesFallback, 1)
    assert.equal(r.rows[1].scene_no, undefined, '对不上的场次不写值')
    assert.ok(r.diff.notices.some((n) => n.includes('场次号')), r.diff.notices.join(' / '))
  })

  await check('场次列：没有该列时不产生场次提示', () => {
    const table = `| 镜头 | 时长 | 画面与动作 |
| --- | --- | --- |
| S01 | 3 | 天台 |`
    const r = rowsFromTable(table, 'markdown-table', { epNo: 1, episodes: EPISODES })
    assert.equal(r.diff.scenesFallback, 0)
    assert.equal(r.rows[0].scene_no, undefined)
    assert.equal(r.diff.notices.some((n) => n.includes('场次号')), false)
  })

  await check('往返：导出 → 解析 → 写回，文字与场次一致、媒体不被清空', () => {
    const existing = [
      {
        ...SHOT,
        id: 'E01-S01',
        no: 'S01',
        scene_no: 2,
        scene_slug: '巷口',
        desc: '雨夜街头，霓虹倒影',
        dialogue: [
          { speaker: '陈默', text: '又是这里。' },
          { speaker: '林小雨', text: '你认得这条路？' },
        ],
        keyframe: '/generated/a.jpg',
        clip: '/videos/a.mp4',
      } as ProjectShot,
    ]
    const src = { projectName: '回收人', episodes: EPISODES, shots: existing }
    const md = episodeMarkdown(src, 1, FIXED)

    // 1) 解析：表格走既有表头映射
    const parsed = rowsFromTable(md.text, 'markdown-table', { epNo: 1, episodes: EPISODES })
    assert.equal(parsed.error, undefined)
    assert.equal(parsed.rows.length, 1)

    // 2) 建镜头：场次与台词按表回填
    const built = buildShotsFromImport(
      parsed.rows.map((r) => ({
        no: r.no,
        scene_no: r.scene_no,
        seconds: r.seconds,
        size: r.size,
        move: r.move,
        desc: r.desc,
        dialogue: r.dialogue,
        keyframe_prompt: r.keyframe_prompt,
        video_prompt: r.video_prompt,
      })),
      EPISODES,
      1,
    )

    // 3) 写回：import 策略，产物字段不在白名单里
    const merged = mergeShotsDraft(existing, built.shots, 1, 'merge', 'import')
    const back = merged.shots[0]

    assert.equal(back.no, 'S01')
    assert.equal(back.seconds, 4)
    assert.equal(back.size, '中景')
    assert.equal(back.move, '推')
    assert.equal(back.desc, '雨夜街头，霓虹倒影', '画面描述与场次必须往返一致')
    assert.equal(back.keyframe_prompt, 'rain-soaked street, neon reflection')
    assert.equal(back.video_prompt, 'slow push-in')
    assert.equal(back.scene_no, 2, '场次必须回到第 2 场')
    assert.equal(back.scene_slug, '巷口')
    const lines = back.dialogue as { speaker: string; text: string }[]
    assert.equal(lines.length, 2, '两个说话人不能被 <br> 挤成一条')
    assert.deepEqual(lines.map((l) => l.speaker), ['陈默', '林小雨'])

    // 产线产物：导入白名单里没有，必须原样保留
    assert.equal(back.keyframe, '/generated/a.jpg')
    assert.equal(back.clip, '/videos/a.mp4')
    assert.equal(merged.added, 0)
    assert.equal(merged.updated, 1)
  })

  await check('zip：条目与集号一一对应，项目名经过净化', () => {
    const src = {
      projectName: '回收/人',
      episodes: [
        { no: 1, title: '雨夜' },
        { no: 2, title: '旧照片' },
        { no: 3, title: '' },
      ],
      shots: SHOTS,
    }
    const zip = buildStoryboardZip(src, FIXED)
    assert.equal(zip.fileName, '回收-人-分镜表.zip')
    assert.deepEqual(zip.entries, ['E01-雨夜.md', 'E02-旧照片.md', 'E03.md'])

    const files = unzipSync(zip.bytes)
    assert.deepEqual(Object.keys(files).sort(), [...zip.entries].sort())
    const text = strFromU8(files['E02-旧照片.md'])
    assert.equal(episodeScopeOf(text).no, 2, 'zip 内每份文件都是单集')
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 分镜表导出净化与表格渲染全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
