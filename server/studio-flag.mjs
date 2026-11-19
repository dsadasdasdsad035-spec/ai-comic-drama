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

/**
 * 创意视图是否在后台预热外壳。
 *
 * 预热会把外壳的 2.6MB 产物拉进常驻容器，换「点开即出」。
 * 弱网、低配或排障时用 `SB_STUDIO_NO_PRELOAD=1` 关掉，退回点击时加载。
 * 与 `keepAlive` 一样走服务端下发：部署后改环境变量重启即可生效，不必重新构建前端。
 */
export function isStudioPreload() {
  return String(process.env.SB_STUDIO_NO_PRELOAD ?? '').trim() !== '1'
}

/** 供前端拉取的开关状态：不带任何宿主细节，避免把内部信息漏给页面 */
export function studioFlagPayload() {
  return {
    ok: true,
    enabled: isStudioEnabled(),
    keepAlive: isStudioKeepAlive(),
    preload: isStudioPreload(),
  }
}

/**
 * 创意视图是否常驻（切走时隐藏而不是卸载）。
 *
 * 常驻是「切回不重建」的前提，但会多占一份宿主前端的内存；
 * 低配机器或排障时可以用 `SB_STUDIO_NO_KEEPALIVE=1` 退回原来的条件渲染。
 * 走服务端下发而不是构建常量：部署后改环境变量重启即可生效，不必重新构建前端。
 */
export function isStudioKeepAlive() {
  return String(process.env.SB_STUDIO_NO_KEEPALIVE ?? '').trim() !== '1'
}
