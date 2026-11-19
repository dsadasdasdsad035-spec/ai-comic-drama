/**
 * 创意入口开关（灰度）。
 *
 * 默认取环境变量 `SB_STUDIO`（未配置即开启）；设置里显式存过 `studioEnabled`
 * 就以设置为准。做成运行时可改而不是只读环境变量，是因为「切回旧链路」需要在
 * 运行中生效：改完立刻隐藏入口、停掉宿主，而不是等下一次重启。
 */
import { getSetting, setSetting } from './db.mjs'

const ENV_DEFAULT = !/^(0|false|off|no)$/i.test(String(process.env.SB_STUDIO ?? '1').trim())

export function isStudioEnabled() {
  const stored = getSetting('studioEnabled')
  if (typeof stored === 'boolean') return stored
  return ENV_DEFAULT
}

export function setStudioEnabled(enabled) {
  const next = Boolean(enabled)
  setSetting('studioEnabled', next)
  return next
}

/** 供前端拉取的开关状态：不带任何宿主细节，避免把内部信息漏给页面 */
export function studioFlagPayload() {
  return { ok: true, enabled: isStudioEnabled() }
}
