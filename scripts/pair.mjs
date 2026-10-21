#!/usr/bin/env node
// Pair a phone with this agent, with no key handling by the user.
//   node scripts/pair.mjs <relay-url> [--wait 300] [--new]
// First run: calls the relay's register op, which creates an account and returns its agent key once. The key goes
// straight into ~/.mortimer/link.env (LINK_URL, ADMIN_KEY; mode 600) and is never printed.
// Later runs (link.env present): ask the relay for a fresh one-time code, e.g. to add a second phone.
// Prints the pairing code, its expiry and the pairing URL, and saves a QR of the URL to ~/.mortimer/pair-qr.svg.
// --wait N: after printing the code, keep checking for up to N seconds until a phone claims it.
// --check N: issue no new code; wait up to N seconds for a phone to claim the last code printed (exit 0 paired, 2 not yet).
// --new: start a fresh account.
// --invite CODE: one-time invite code for sign-up (or env MORTIMER_INVITE).
// Env: MORTIMER_DIR (default ~/.mortimer), MORTIMER_RELAY (default relay URL), MORTIMER_INVITE (invite token
// if the relay requires one).
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Set to the hosted relay's https URL once it is deployed (alfred-relay). Empty until then.
const DEFAULT_RELAY = 'https://alfred-relay-mu.vercel.app'
const DIR = process.env.MORTIMER_DIR || join(homedir(), '.mortimer')
const ENV = join(DIR, 'link.env')
const args = process.argv.slice(2)
const flag = n => args.includes(`--${n}`)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const positional = args.filter((a, i) => !a.startsWith('--') && !['--wait', '--check', '--invite'].includes(args[i - 1]))
const out = s => process.stdout.write(s + '\n')
const die = (s, code = 1) => { process.stderr.write(`pair: ${s}\n`); process.exit(code) }

function readEnv() {
  try {
    return Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  } catch { return null }
}

function writeSecret(file, text) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, file)
}

async function call(base, op, { key, body, invite } = {}) {
  const headers = { 'content-type': 'application/json', 'user-agent': 'mortimer' }
  if (key) headers['x-admin-key'] = key
  if (invite) headers['x-invite'] = invite
  const r = await fetch(`${base}/api/admin?op=${op}`, {
    method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  let data = {}
  try { data = JSON.parse(text || '{}') } catch { /* not json */ }
  return { status: r.status, data }
}

const clean = u => String(u || '').trim().replace(/\/+$/, '')
let env = flag('new') ? null : readEnv()
let base, key

if (env?.LINK_URL && env?.ADMIN_KEY) {
  base = clean(env.LINK_URL); key = env.ADMIN_KEY
  if (positional[0] && clean(positional[0]) !== base) die(`already linked to a different relay. Rerun with --new to start over there.`)
} else {
  base = clean(positional[0] || process.env.MORTIMER_RELAY || DEFAULT_RELAY)
  if (!/^https?:\/\/[^\s/]+/.test(base)) die('give the relay URL: node scripts/pair.mjs https://<relay>')
  if (!/^https:/.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) die('the relay must use https (http only for 127.0.0.1)')
}

const devices = async () => { const r = await call(base, 'devices', { key }); return r.status === 200 ? r.data.devices : null }
async function waitFor(seconds, since) {
  const end = Date.now() + Math.min(seconds, 900) * 1000
  while (Date.now() < end) {
    const d = await devices().catch(() => null)
    const hit = d?.filter(x => x.paired >= since).at(-1)
    if (hit) { out(`Paired: ${hit.name}`); process.exit(0) }
    await new Promise(r => setTimeout(r, 3000))
  }
  out('No phone paired yet. The code stays valid until it expires; run again for a new one.')
  process.exit(2)
}
const STATE = join(DIR, 'pair-state.json')

if (opt('check')) {
  if (!key) die('nothing to check: no link.env yet. Run without --check first.')
  let since = 0
  try { since = JSON.parse(readFileSync(STATE, 'utf8')).issued } catch { /* none */ }
  if (!since) die('no pairing code issued yet. Run without --check first.')
  await waitFor(Number(opt('check')), since)
}

let pairing
if (key) {
  const r = await call(base, 'pairing', { key, body: {} })
  if (r.status === 404) die('the relay does not recognise the saved key. Rerun with --new to create a fresh account.')
  if (r.status !== 200) die(`relay said ${r.status}${r.data.error ? `: ${r.data.error}` : ''}`)
  pairing = r.data.pairing
} else {
  const r = await call(base, 'register', { body: { name: process.env.USER ? String(process.env.USER).slice(0, 40) : '' }, invite: opt('invite', process.env.MORTIMER_INVITE) })
  if (r.status === 403) die('this relay needs an invite code, or the one given is used or expired. Rerun with --invite XXXX-XXXX.')
  if (r.status !== 200 || !r.data.agent_key) die(`relay said ${r.status}${r.data.error ? `: ${r.data.error}` : ''}`)
  if (existsSync(ENV)) renameSync(ENV, `${ENV}.bak`)
  key = r.data.agent_key
  writeSecret(ENV, `# Written by scripts/pair.mjs. Secret: never print or share.\nLINK_URL=${base}\nADMIN_KEY=${key}\n`)
  pairing = r.data.pairing
  out('Account created. Key saved to link.env (mode 600).')
}

if (!pairing?.code) die('relay returned no pairing code')
const issued = Date.parse(pairing.issued_at) || Date.now()
writeSecret(STATE, JSON.stringify({ issued, expires: pairing.expires_at }) + '\n')
if (pairing.qr_svg) writeSecret(join(DIR, 'pair-qr.svg'), pairing.qr_svg)
const exp = new Date(pairing.expires_at)
out(`Pairing code: ${pairing.code} (one use, expires ${exp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`)
out(`Pairing link: ${pairing.url}`)
out(`QR code: ${join(DIR, 'pair-qr.svg')} (or open the link on this computer and scan it with the phone)`)

if (Number(opt('wait', 0)) > 0) await waitFor(Number(opt('wait')), issued)
