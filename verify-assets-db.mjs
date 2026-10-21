/**
 * 素材库（assets 表）验证：
 * 1) 新建工程时 assets 为空数组
 * 2) POST assets 全量替换 → GET 读回（顺序/字段不丢）
 * 3) 不影响 shots / characters / episodes
 * 4) 二次写入（更新）可覆盖，且不会重复行
 * 跑法：node verify-assets-db.mjs
 */
import fs from 'node:fs'
const URL = 'http://localhost:5273'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())
const P = '/api/project?name=recycle'
const before = (await api(P)).project
const backup = { assets: before.assets, shots: before.shots.length, chars: before.characters.length }

const setAssets = async (assets) => {
  const r = await api(P, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assets }),
  })
  return r
}

try {
  const empty = (await api(P)).project.assets
  check('assets 字段存在且为数组', Array.isArray(empty), JSON.stringify(empty)?.slice(0, 60))

  const demo = [
    { kind: 'scene', title: '废土夜市', url: '/generated/shot-1792463350590-e1bff0.jpg', note: '主场景，雨夜', tags: ['夜景', '霓虹'] },
    { kind: 'prop', title: '义体手臂', url: '/generated/shot-1792463351262-d5fb9c.jpg', note: '银色机械义臂', tags: ['道具'] },
  ]
  const w = await setAssets(demo)
  check('POST assets 成功', w.ok === true)

  const got = (await api(P)).project.assets
  check('读回条数一致', got.length === 2, String(got.length))
  check('顺序保持', got[0].title === '废土夜市' && got[1].title === '义体手臂', got.map((a) => a.title).join(','))
  check('字段不丢（kind/url/note/tags）',
    got[0].kind === 'scene' && got[0].url.includes('/generated/') && got[0].note.includes('雨夜') && got[0].tags.includes('霓虹'),
    JSON.stringify(got[0]))

  const after = (await api(P)).project
  check('shots 未受影响', after.shots.length === backup.shots, `${backup.shots} → ${after.shots.length}`)
  check('characters 未受影响', after.characters.length === backup.chars)
  check('episodes 未受影响', (after.episodes ?? []).length === (before.episodes ?? []).length)

  // 覆盖写（改名）→ 不重复
  await setAssets([{ ...demo[0], title: '废土夜市（改）' }])
  const got2 = (await api(P)).project.assets
  check('全量替换不留旧行', got2.length === 1, String(got2.length))
  check('改名生效', got2[0].title === '废土夜市（改）', got2[0].title)
} finally {
  await setAssets(backup.assets ?? [])
  const now = (await api(P)).project
  check('已还原', (now.assets ?? []).length === (backup.assets ?? []).length)
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
