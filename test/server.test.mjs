// End to end: a fake relay, the real server over stdio, an MCP client standing in for Claude Code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('taps arrive as channel messages, cards and status reach the relay', async () => {
  const queue = [{ id: 'tap-000001', cmd: 'today', at: Date.now() }, { id: 'tap-000002', cmd: 'reply', text: 'approved at the terminal' }]
  const got = {}
  const relay = http.createServer((req, res) => {
    const op = new URL(req.url, 'http://x').searchParams.get('op')
    if (req.headers['x-admin-key'] !== 'test-key') { res.writeHead(404); return res.end() }
    let body = ''
    req.on('data', d => (body += d))
    req.on('end', () => {
      if (op === 'poll') { const cmds = queue.splice(0); res.end(JSON.stringify({ cmds })); return }
      (got[op] ||= []).push(JSON.parse(body || '{}'))
      res.end('{"ok":true}')
    })
  })
  await new Promise(r => relay.listen(0, '127.0.0.1', r))
  const dir = mkdtempSync(join(tmpdir(), 'mortimer-'))
  writeFileSync(join(dir, 'link.env'), `LINK_URL=http://127.0.0.1:${relay.address().port}\nADMIN_KEY=test-key\n`)

  const client = new Client({ name: 'test', version: '0' })
  const inbound = []
  client.fallbackNotificationHandler = async n => { if (n.method === 'notifications/claude/channel') inbound.push(n.params) }
  const transport = new StdioClientTransport({ command: 'node', args: [join(ROOT, 'server.mjs')], env: { ...process.env, MORTIMER_DIR: dir, MORTIMER_POLL_MS: '150' }, stderr: 'pipe' })
  await client.connect(transport)
  try {
    const caps = client.getServerCapabilities()
    assert.ok(caps.experimental?.['claude/channel'], 'declares the channel capability')
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(t => t.name).sort(), ['capabilities', 'card', 'status'])

    for (let i = 0; i < 40 && inbound.length < 1; i++) await new Promise(r => setTimeout(r, 100))
    await new Promise(r => setTimeout(r, 400))
    assert.equal(inbound.length, 1, 'the fake terminal approval was dropped')
    assert.equal(inbound[0].content, '/today')
    assert.equal(inbound[0].meta.kind, 'today')

    const bad = await client.callTool({ name: 'card', arguments: { title: 'x', chips: [{ label: 'WAY TOO LONG A LABEL', send: 'y' }] } })
    assert.equal(bad.isError, true)
    // The server posted the first live step itself when it handed over the tap.
    assert.equal(got.status[0].now, 'Picked up TODAY')
    assert.equal(got.status[0].mode, 'active')
    const good = await client.callTool({ name: 'card', arguments: { title: 'Today', lines: ['19:30 Dinner'], chips: [{ label: 'TODO', send: '/todo' }] } })
    assert.equal(good.isError, undefined)
    assert.equal(got.answer.at(-1).title, 'Today')
    // ...and closed the task when the card went out, though the model never called status done.
    assert.equal(got.status.at(-1).mode, 'done')
    assert.equal(got.status.at(-1).now, 'Today')
    assert.deepEqual(got.status.at(-1).steps, ['Picked up TODAY'])

    await client.callTool({ name: 'status', arguments: { action: 'set', text: 'Checking calendar' } })
    assert.equal(got.status.at(-1).now, 'Checking calendar')
    assert.equal(got.status.at(-1).mode, 'active')

    const t = await client.callTool({ name: 'capabilities', arguments: { caps: ['calendar', 'github'] } })
    const parsed = JSON.parse(t.content[0].text)
    assert.ok(parsed.live.includes('TODAY'))
    assert.ok(parsed.locked.some(l => l.tile === 'TRIAGE'))
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'caps.json'), 'utf8')).caps, ['calendar', 'github'])
    // The phone's tile list went to the relay at startup and again after the capabilities call.
    assert.ok(got.flows.length >= 2)
    assert.ok(got.flows.at(-1).tiles.includes('today') && got.flows.at(-1).tiles.includes('unlock'))
    assert.ok(got.flows.at(-1).flows.unlock.steps[0].options.some(o => o.value === 'gmail'))
  } finally {
    await client.close()
    relay.close()
  }
})
