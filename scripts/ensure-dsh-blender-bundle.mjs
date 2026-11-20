#!/usr/bin/env node
/**
 * npm install 后把 dsh-blender-plugin 写进创意宿主 profile 的 bundles（与 server 启动时逻辑一致）。
 * 缺 npm 包时只打日志，不失败（postinstall 不应阻断安装）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureStateDir } from '../server/paths.mjs'
import {
  BLENDER_PLUGIN_BUNDLE,
  blenderPluginDir,
  installCreativeToolsBundle,
} from '../server/dsh-bundle.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function main() {
  const entry = path.join(blenderPluginDir(ROOT), 'lib', 'index.js')
  if (!fileExists(entry)) {
    console.warn(
      `[dsh-blender] 未安装 ${BLENDER_PLUGIN_BUNDLE}，跳过 profile 登记（npm install dsh-blender-plugin@3.1.0-alpha.1 --legacy-peer-deps）`,
    )
    return
  }
  const dshHome = ensureStateDir(ROOT, 'dsh')
  installCreativeToolsBundle({ dshHome, root: ROOT, log: (line) => console.log(line) })
  console.log('[dsh-blender] 已写入创意宿主 profile bundles（含 dsh-blender-plugin）')
}

function fileExists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

main()