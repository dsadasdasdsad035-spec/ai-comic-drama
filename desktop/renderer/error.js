/**
 * 错误页脚本：填充错误摘要、接上「重启服务」。
 *
 * 参数从 query 来（主进程用 loadFile 的 search 传），解析失败就退回默认文案，
 * 不让错误页自己再抛一次错。
 */

const params = new URLSearchParams(location.search)
const title = params.get('title') || '本地服务启动失败'
const detail = params.get('detail') || ''
const mode = params.get('mode') || 'error'

document.title = title
document.getElementById('title').textContent = title
document.getElementById('log').textContent = detail || '（没有可显示的日志）'

if (mode === 'restart') {
  document.getElementById('badge').textContent = '已断开'
  document.getElementById('hint').textContent =
    '本地服务已经停止。你所在的工作区数据仍在磁盘上，重启服务后会回到原页面。'
}

const retry = document.getElementById('retry')
const copy = document.getElementById('copy')

retry.addEventListener('click', async () => {
  retry.disabled = true
  retry.textContent = '正在重启…'
  try {
    await window.desktop?.restartService?.()
  } finally {
    // 成功时主进程会切走页面；失败会重新加载错误页，这里的恢复只是兜底
    retry.disabled = false
    retry.textContent = '重启服务'
  }
})

copy.addEventListener('click', async () => {
  const text = document.getElementById('log').textContent || ''
  try {
    await navigator.clipboard.writeText(text)
    copy.textContent = '已复制'
    setTimeout(() => {
      copy.textContent = '复制日志'
    }, 1500)
  } catch {
    copy.textContent = '复制失败'
  }
})
