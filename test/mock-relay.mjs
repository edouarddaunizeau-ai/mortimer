// Fake relay for manual runs: node test/mock-relay.mjs <port> <logfile> [queue.json]. Logs every op it receives.
import http from 'node:http'
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
const [port, logf, qf] = process.argv.slice(2)
http.createServer((req, res) => {
  const op = new URL(req.url, 'http://x').searchParams.get('op')
  let body = ''
  req.on('data', d => (body += d))
  req.on('end', () => {
    if (op === 'poll') {
      let cmds = []
      if (qf && existsSync(qf)) { cmds = JSON.parse(readFileSync(qf, 'utf8') || '[]'); writeFileSync(qf, '[]') }
      if (cmds.length) appendFileSync(logf, JSON.stringify({ op: 'poll', cmds }) + '\n')
      return res.end(JSON.stringify({ cmds }))
    }
    appendFileSync(logf, JSON.stringify({ op, body: JSON.parse(body || '{}') }) + '\n')
    res.end('{"ok":true}')
  })
}).listen(Number(port), '127.0.0.1')
