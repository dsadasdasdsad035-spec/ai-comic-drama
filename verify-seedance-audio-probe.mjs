/**
 * 只读能力探测：APIMart Seedance 2.5 schema + 本地能力描述。
 * 不提交视频任务，不打印 Key。
 * 跑法：node verify-seedance-audio-probe.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seedance-audio-probe-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/nativeAudio.ts'))}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const lib = await import(bundle)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const AUDIO_FIELDS = ['audio_url', 'reference_audio', 'audio_urls', 'reference_audios', 'audio_with_roles']
const probeProps = (props) => {
  const field = (props || []).find((p) => AUDIO_FIELDS.includes(p))
  return { supported: Boolean(field), field: field || '' }
}
check('schema 有 audio_url', probeProps(['prompt', 'audio_url', 'generate_audio']).field === 'audio_url')
check('schema 没有音频参考', !probeProps(['prompt', 'generate_audio']).supported)
check('schema 字段名不同', probeProps(['prompt', 'reference_audio']).field === 'reference_audio')

const caps = lib.audioRefCapabilitiesFor({ providerKind: 'apimart', model: 'seedance-2.5', audioOut: true })
check('APIMart Seedance 2.5 实测能力', caps?.audioRefField === 'audio_url' && caps.maxRefAudios === 1 && caps.minVideoSeconds === 4)
check('未知模型不开放', lib.audioRefCapabilitiesFor({ providerKind: 'apimart', model: 'unknown', audioOut: true }) === null)

const dbFile = path.join(root, 'projects/storyboard.sqlite')
if (fs.existsSync(dbFile)) {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const row = db.prepare("SELECT value FROM settings WHERE key='app'").get()
  db.close()
  const settings = row?.value ? JSON.parse(row.value) : {}
  const provider = (settings.providers || []).find((p) => p.id === 'apimart')
  const key = provider?.apiKey || process.env.APIB_API_KEY || process.env.APIMART_API_KEY || ''
  if (key) {
    const base = String(provider?.baseUrl || 'https://api.apimart.ai/v1').replace(/\/+$/, '')
    const r = await fetch(`${base}/models/seedance-2.5/schema`, { headers: { Authorization: `Bearer ${key}` } })
    const j = await r.json()
    const props = Object.keys(j?.input_schema?.properties || {})
    const probed = probeProps(props)
    check('真实 schema 可读', r.ok && props.length > 0)
    check('真实 schema 没有音频参考字段', !probed.supported)
    check('真实 schema 有 generate_audio', props.includes('generate_audio'))
    console.log('schema audio fields:', props.filter((k) => /audio/i.test(k)).join(', ') || '(none)')
    console.log('empirical fallback:', JSON.stringify(caps))
  } else {
    console.log('skip real probe: no APIMart key')
  }
} else {
  console.log('skip real probe: no projects/storyboard.sqlite')
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
