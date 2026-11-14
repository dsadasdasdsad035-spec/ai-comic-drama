/**
 * 本地假 SMTP 服务：只实现足以收一封信的最小状态机。
 * 用途是验证 server/billing/email.mjs 的 smtp 分支真的把邮件投递出去了。
 */
import net from 'node:net'

export function startFakeSmtp({ port = 0 } = {}) {
  const received = []
  const server = net.createServer((socket) => {
    let stage = 'cmd'
    let buffer = ''
    let from = ''
    let to = ''
    let data = ''
    const send = (line) => socket.write(line + '\r\n')

    send('220 fake-smtp ready')

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')

      while (true) {
        if (stage === 'data') {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end === -1) return
          data = buffer.slice(0, end)
          buffer = buffer.slice(end + 5)
          received.push({ from, to, data })
          send('250 OK queued')
          stage = 'cmd'
          continue
        }

        const idx = buffer.indexOf('\r\n')
        if (idx === -1) return
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        const upper = line.toUpperCase()
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          // 故意不宣告 AUTH / STARTTLS，避免 nodemailer 走鉴权分支
          socket.write('250-fake-smtp\r\n250 8BITMIME\r\n')
        } else if (upper.startsWith('MAIL FROM:')) {
          from = line.slice(line.indexOf(':') + 1).trim()
          send('250 OK')
        } else if (upper.startsWith('RCPT TO:')) {
          to = line.slice(line.indexOf(':') + 1).trim()
          send('250 OK')
        } else if (upper === 'DATA') {
          stage = 'data'
          data = ''
          send('354 End data with <CR><LF>.<CR><LF>')
        } else if (upper === 'QUIT') {
          send('221 Bye')
          socket.end()
        } else if (upper === 'RSET') {
          send('250 OK')
        } else {
          send('502 未实现')
        }
      }
    })

    socket.on('error', () => {})
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        received,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}
