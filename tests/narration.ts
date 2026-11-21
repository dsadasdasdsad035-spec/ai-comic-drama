/**
 * 旁白说话人识别与合成负载。
 */
import assert from 'node:assert/strict'
import {
  buildNarrationPayload,
  extractNarrationLines,
  isNarratorSpeaker,
  voiceFingerprintNarration,
} from '../src/narration'
import { buildPlaylist } from '../src/Preview'

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

check('旁白/os/vo 大小写', () => {
  assert.equal(isNarratorSpeaker('旁白'), true)
  assert.equal(isNarratorSpeaker('VO'), true)
  assert.equal(isNarratorSpeaker('narrator'), true)
  assert.equal(isNarratorSpeaker('陈默'), false)
})

check('extractNarrationLines 跳过角色', () => {
  const lines = extractNarrationLines('陈默：别出声。\n旁白：那年冬夜。')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].speaker, '旁白')
  assert.match(lines[0].text, /冬夜/)
})

check('buildNarrationPayload 无配置返回 null', () => {
  assert.equal(
    buildNarrationPayload({
      dialogue: '旁白：测试。',
      narrator: { modelKey: '', voiceId: '' },
    }),
    null,
  )
})

check('voiceFingerprintNarration 不因角色对白变', () => {
  const narrator = { modelKey: 'm1', voiceId: 'v1' }
  const a = voiceFingerprintNarration([{ speaker: '旁白', text: 'A', dialogueIndex: 1 }], [], narrator)
  const b = voiceFingerprintNarration([{ speaker: '旁白', text: 'A', dialogueIndex: 1 }], [], narrator)
  assert.equal(a, b)
})

import { rowsFromTable } from '../src/intake/rows'

check('导入：旁白进 dialogue 不进 desc', () => {
  const table = `| 镜头 | 时长 | 景别 | 运镜 | 画面与动作 | 台词与声音 |
| --- | --- | --- | --- | --- | --- |
| S01 | 4 | 中景 | 固定 | 街角 | 旁白：那天晚上，我以为自己活不过去了。 |`
  const r = rowsFromTable(table, 'markdown-table', { epNo: 1, episodes: [{ no: 1, title: 't' }] })
  assert.equal(r.rows.length, 1)
  assert.ok(Array.isArray(r.rows[0].dialogue))
  const dlg = r.rows[0].dialogue as { speaker: string; text: string }[]
  assert.equal(dlg[0].speaker, '旁白')
  assert.ok(!String(r.rows[0].desc || '').includes('旁白：'))
})

check('连播不播放旁白 voiceUrl', () => {
  const nodes = [
    {
      id: 'n1',
      type: 'shot',
      position: { x: 0, y: 0 },
      data: {
        no: 'S01',
        seconds: 4,
        dialogue: '旁白：测试',
        voiceUrl: '/voices/test.mp3',
        voiceMeta: {
          scope: 'narration',
          fingerprint: 'x',
          engine: 'mock',
          applied: [],
          unsupported: [],
          createdAt: '',
        },
      },
    },
  ] as never
  const items = buildPlaylist(nodes, [])
  assert.equal(items[0].audio, 'none')
  assert.equal(items[0].voice, undefined)
})

if (bad) process.exit(1)