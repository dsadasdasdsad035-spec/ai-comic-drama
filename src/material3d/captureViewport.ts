import type { Camera, Engine } from '@babylonjs/core'

/** 捕获当前视口为 PNG Blob，供上传登记项目素材 */
export async function captureViewportPng(engine: Engine, camera: Camera): Promise<Blob> {
  const BABYLON = await import('@babylonjs/core')
  const size = engine.getRenderWidth()
  const height = engine.getRenderHeight()
  const dataUrl = await BABYLON.Tools.CreateScreenshotUsingRenderTargetAsync(engine, camera, {
    width: size,
    height,
    precision: 1,
  })
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return `data:image/png;base64,${btoa(bin)}`
}