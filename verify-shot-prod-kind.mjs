/**
 * 镜头 prodKind 水合规则（四类：双轨、仅图、仅片、空白）
 * 跑法：node verify-shot-prod-kind.mjs
 */
import {
  inferProdKindFromProjectShot,
  inferProdKindFromShotData,
} from './src/shotProdKind.ts'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

check(
  '仅静帧',
  inferProdKindFromProjectShot({ id: 'E01-S01', keyframe: '/generated/a.jpg' }) === 'image',
)
check(
  '仅出片',
  inferProdKindFromProjectShot({ id: 'E01-S02', clip: '/videos/a.mp4' }) === 'video',
)
check(
  '双轨优先出片',
  inferProdKindFromProjectShot({
    id: 'E01-S03',
    keyframe: '/generated/a.jpg',
    clip: '/videos/a.mp4',
  }) === 'video',
)
check('空白默认出片', inferProdKindFromProjectShot({ id: 'E01-S04' }) === 'video')
check(
  '画布态双轨',
  inferProdKindFromShotData({
    no: 'S01',
    refImage: '/x.jpg',
    videoUrl: '/y.mp4',
    marks: [],
  }) === 'video',
)

if (bad) process.exit(1)
console.log('verify-shot-prod-kind: 全部通过')
