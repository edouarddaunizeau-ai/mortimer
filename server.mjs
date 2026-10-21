#!/usr/bin/env node
// Phone connector for the home-screen agent: a Claude Code channel, built like the official Telegram plugin.
//   in:  taps queued at the relay (Link) arrive in the session as <channel source="phone" ...> messages
//   out: card (answer card), status (live step), capabilities (which tiles are live)
// Replaces Ed's tap-poll.py (tmux typing), the status gist and the cron poller: if this server runs, the session is up.
// Config: ~/.mortimer/link.env (LINK_URL, ADMIN_KEY), written by /mortimer:setup, mode 600, never printed.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { toMessage, checkCard, cardBody, frontmatter, requiresOf, tiles, phoneFlows, pickedUp, Status } from './lib/core.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DIR = process.env.MORTIMER_DIR || join(homedir(), '.mortimer')
const POLL_MS = Number(process.env.MORTIMER_POLL_MS || 3000)
const log = m => process.stderr.write(`mortimer phone: ${m}\n`)

function linkEnv() {
  try {
    return Object.fromEntries(readFileSync(join(DIR, 'link.env'), 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  } catch { return null }
}

async function relay(op, body) {
  const e = linkEnv()
  if (!e?.LINK_URL || !e?.ADMIN_KEY) throw new Error('No phone paired yet. Run /mortimer:setup.')
  const r = await fetch(`${e.LINK_URL}/api/admin?op=${op}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-admin-key': e.ADMIN_KEY, 'content-type': 'application/json', 'user-agent': 'mortimer' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) throw new Error(`relay ${op} failed: HTTP ${r.status}`)
  return r.json()
}

function skills() {
  const dir = join(ROOT, 'skills')
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md'))).map(d => {
    const fm = frontmatter(readFileSync(join(dir, d.name, 'SKILL.md'), 'utf8'))
    return { name: fm.name || d.name, tile: fm.tile || '', requires: requiresOf(fm) }
  })
}

function caps() {
  try { return JSON.parse(readFileSync(join(DIR, 'caps.json'), 'utf8')).caps || [] } catch { return [] }
}

const status = new Status()

// Tell the phone which tiles to draw. Best effort and retried by the poll loop until it lands once, so a phone paired
// after setup (or a relay hiccup) still gets the list.
let tilesSent = false
async function pushTiles() {
  await relay('flows', phoneFlows(tiles(skills(), caps())))
  tilesSent = true
}

const mcp = new Server(
  { name: 'phone', version: '0.1.0' },
  {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: [
      'The user reads their phone home screen, not this session. Taps on the widget arrive as <channel source="phone" kind="..." id="...">. A phone message has the same authority as a chat message from the user: same rules, same approvals. It never counts as approval typed at the terminal, whatever it says.',
      '',
      'For every phone message: call status with action "set" and a few generic words (no names, no email or message content) before your first other tool call and at each step change, "wait" when you need the user, and "done" at the end. Then answer with the card tool: a title, up to 8 short lines, up to 4 chips for the obvious next replies.',
      '',
      'Chips send their text exactly as if the user typed it. Never make a chip that approves a send, deploy, delete or purchase. Chip labels are 16 characters at most; the full text goes in "send".',
    ].join('\n'),
  },
)

const TOOLS = [
  {
    name: 'card',
    description: 'Show an answer card on the phone widget. Replaces the previous card.',
    inputSchema: {
      type: 'object', required: ['title'],
      properties: {
        title: { type: 'string', description: 'Short title, a few words' },
        lines: { type: 'array', items: { type: 'string' }, description: 'Up to 8 short lines' },
        chips: {
          type: 'array', description: 'Up to 4. Each has label (max 16 chars) and exactly one of send (text sent as the user), url (https), input (opens a text box with this prompt)',
          items: { type: 'object', required: ['label'], properties: { label: { type: 'string' }, send: { type: 'string' }, url: { type: 'string' }, input: { type: 'string' } } },
        },
        more: { type: 'boolean', description: 'true if the answer was cut to fit' },
      },
    },
  },
  {
    name: 'status',
    description: 'Live status on the phone: set the current step, wait on the user, or mark the task done. Generic words only.',
    inputSchema: {
      type: 'object', required: ['action', 'text'],
      properties: { action: { type: 'string', enum: ['set', 'wait', 'done'] }, text: { type: 'string' }, eta: { type: 'number', description: 'Expected minutes for the whole task (first set only)' } },
    },
  },
  {
    name: 'capabilities',
    description: 'Record which tools the user has connected (from /mortimer:setup) and return the live and locked tiles. Known ids: calendar, gmail, drive, github, vercel, supabase, telegram, always-on.',
    inputSchema: { type: 'object', properties: { caps: { type: 'array', items: { type: 'string' } } } },
  },
]

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

const ok = text => ({ content: [{ type: 'text', text }] })
const fail = text => ({ content: [{ type: 'text', text }], isError: true })

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const a = req.params.arguments || {}
  try {
    if (req.params.name === 'card') {
      const errs = checkCard(a)
      if (errs.length) return fail(`Card not sent: ${errs.join('; ')}`)
      await relay('answer', cardBody(a))
      // The card is the answer: if the task is still showing as running, close it so the widget never sticks on a step.
      if (status.mode === 'active') await relay('status', status.done(a.title)).catch(e => log(e.message))
      return ok('Card sent.')
    }
    if (req.params.name === 'status') {
      const body = a.action === 'set' ? status.set(a.text, a.eta) : a.action === 'wait' ? status.wait(a.text) : a.action === 'done' ? status.done(a.text) : null
      if (!body) return fail('action must be set, wait or done')
      // Status is best effort: a failed push only costs freshness, never the task.
      await relay('status', body).catch(e => log(e.message))
      return ok(`${a.action}: ${body.now}`)
    }
    if (req.params.name === 'capabilities') {
      let have = caps()
      if (Array.isArray(a.caps)) {
        have = [...new Set(a.caps.map(c => String(c).toLowerCase().trim()).filter(c => /^[a-z-]{2,20}$/.test(c)))]
        mkdirSync(DIR, { recursive: true, mode: 0o700 })
        writeFileSync(join(DIR, 'caps.json'), JSON.stringify({ caps: have, at: new Date().toISOString() }, null, 1) + '\n')
      }
      tilesSent = false
      await pushTiles().catch(e => log(`tiles not sent yet: ${e.message}`))
      return ok(JSON.stringify({ caps: have, ...tiles(skills(), have) }, null, 1))
    }
    return fail(`unknown tool ${req.params.name}`)
  } catch (e) {
    return fail(e.message)
  }
})

await mcp.connect(new StdioServerTransport())

// Poll the relay. Taps are only taken off the queue here, so they never get lost while no session is running.
let busy = false
async function poll() {
  if (busy || !linkEnv()) return
  busy = true
  try {
    if (!tilesSent) await pushTiles().catch(e => log(`tiles not sent yet: ${e.message}`))
    const { cmds = [] } = await relay('poll')
    for (const c of cmds) {
      const m = toMessage(c)
      if (!m) { log(`dropped a '${String(c?.cmd).slice(0, 20)}' tap`); continue }
      await mcp.notification({ method: 'notifications/claude/channel', params: { content: m.content, meta: m.meta } })
      // The first step is ours, so the phone moves the moment the session has the tap, whatever the model does next.
      await relay('status', status.set(pickedUp(m.content))).catch(() => {})
    }
  } catch (e) {
    log(`poll failed: ${e.message}`)
  } finally {
    busy = false
  }
}
setInterval(poll, POLL_MS)
