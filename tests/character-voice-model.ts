import {
  providerIdForAudioModelKey,
  resolveCharacterAudioModelKey,
  resolveVoiceForSpeaker,
} from '../src/voiceCatalog'

const settings = {
  defaults: { audio: 'volc-tts' },
  models: [
    { key: 'minimax-tts', provider: 'minimax' },
    { key: 'volc-tts', provider: 'volc-tts' },
  ],
}

let bad = 0
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}

check(
  '角色 voiceModelKey 优先',
  resolveCharacterAudioModelKey({ voiceModelKey: 'minimax-tts' }, settings) === 'minimax-tts',
)
check(
  '未绑定回落默认',
  resolveCharacterAudioModelKey({}, settings) === 'volc-tts',
)
check('无设置为空', resolveCharacterAudioModelKey({}, null) === '')
check(
  'provider 解析',
  providerIdForAudioModelKey(settings, 'minimax-tts') === 'minimax',
)

const charProvider = providerIdForAudioModelKey(
  settings,
  resolveCharacterAudioModelKey({ voiceModelKey: 'minimax-tts' }, settings),
)
const okCross = resolveVoiceForSpeaker({
  character: { voiceId: 'male-qn-qingse', voiceProvider: 'minimax' },
  currentProviderId: charProvider,
  fallbackVoice: 'Tingting',
})
check(
  'MiniMax 角色不因全局默认渠道误报',
  okCross.ok && okCross.voice === 'male-qn-qingse',
)

const mismatch = resolveVoiceForSpeaker({
  character: { voiceId: 'male-qn-qingse', voiceProvider: 'minimax' },
  currentProviderId: 'volc-tts',
  fallbackVoice: 'Tingting',
})
check('渠道不一致仍报错', !mismatch.ok)

if (bad) {
  console.error(`\n${bad} failed`)
  process.exit(1)
}
console.log('\n全部通过')
