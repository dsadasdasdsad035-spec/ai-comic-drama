import type { CharacterSheet } from '../src/characters'
import { resolveVoiceUiState } from '../src/voiceUiState'

const settings = {
  defaults: { audio: 'volc-tts' },
  models: [
    { key: 'minimax-tts', label: 'MiniMax', cap: 'audio' as const, provider: 'minimax', model: 'speech' },
    { key: 'volc-tts', label: 'Volc', cap: 'audio' as const, provider: 'volc-tts', model: 'seed' },
  ],
  providers: [],
} as any

const baseChar: CharacterSheet = {
  id: 'a',
  name: 'A',
  role: '主角',
  lookCn: '',
  lookEn: 'look',
  palette: '',
  keywords: [],
}

let bad = 0
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}

const mismatch = resolveVoiceUiState({
  projectName: 'p',
  character: { ...baseChar, voiceId: 'x', voiceProvider: 'minimax', voiceModelKey: 'volc-tts' },
  settings,
  voicesCount: 3,
  sampleStale: false,
  sampleText: 'hi',
})
check('渠道不一致阻塞', mismatch.kind === 'provider_mismatch' && !mismatch.canGenerateSample)

const noVoice = resolveVoiceUiState({
  projectName: 'p',
  character: baseChar,
  settings,
  voicesCount: 3,
  sampleStale: false,
  sampleText: 'hi',
})
check('未选音色', noVoice.kind === 'no_voice_id' && !noVoice.canGenerateSample)

const noVoices = resolveVoiceUiState({
  projectName: 'p',
  character: { ...baseChar, voiceId: 'v1' },
  settings,
  voicesCount: 0,
  sampleStale: false,
  sampleText: 'hi',
})
check('无音色目录', noVoices.kind === 'no_voices')

if (bad) process.exit(1)
console.log('\n全部通过')
