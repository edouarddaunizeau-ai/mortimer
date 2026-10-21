// Pure helpers for the phone connector: no network, no files, so test/core.test.mjs can cover them.
// Ported from jarvis-brain bin/tap-poll.py and bin/app-link.py (Ed's Jarvis, Oct 2026).

export const SIMPLE = new Set(['brief', 'today', 'todo', 'triage', 'subs', 'fit', 'portfolio'])
export const WITH_TEXT = new Set(['prep', 'watch', 'build', 'ship', 'post', 'gtm', 'decide', 'trip', 'validate', 'weekends'])
// A tap may never pass itself off as a terminal approval.
export const CLAIMS = /approv\w*\s+(at|in|from)\s+the\s+terminal/i
export const CHIP_MAX = 16

export function clean(s, n = 1500) {
  return String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
}

// Queued phone command {id, cmd, text?, path?} -> {content, meta} for the session, or null to drop it.
// Text is flattened to one line and capped, and it never starts with "/" or "!" unless we built that command ourselves.
export function toMessage(c) {
  if (!c || typeof c !== 'object') return null
  const cmd = String(c.cmd || '')
  const text = clean(c.text)
  const path = (Array.isArray(c.path) ? c.path : []).map(p => clean(p, 80)).filter(Boolean)
  let out
  if (SIMPLE.has(cmd)) out = `/${cmd}`
  else if (WITH_TEXT.has(cmd)) out = `/${cmd} ${text}`.trim()
  else if (cmd === 'flow' && path.length) {
    const head = path[0].toLowerCase()
    if (!/^[a-z-]{2,20}$/.test(head)) return null
    out = `/${head} ${path.slice(1).join(' ')}`.trim() + (text ? `: ${text}` : '')
  } else if (['reply', 'chip', 'new'].includes(cmd) && text) out = text.replace(/^[!]+/, '')
  else return null
  if (CLAIMS.test(out)) return null
  const meta = { kind: cmd, id: clean(c.id, 40) }
  if (c.device) meta.device = clean(c.device, 40)
  if (c.at) meta.ts = new Date(Number(c.at)).toISOString()
  return { content: out.trim(), meta }
}

// Answer card checks, same contract as app-link.py: title, up to 8 lines, up to 4 chips, labels <= 16 chars.
export function checkCard(card) {
  const errs = []
  if (!card || typeof card !== 'object') return ['card must be an object']
  if (!clean(card.title, 60)) errs.push('title is required')
  const lines = Array.isArray(card.lines) ? card.lines : []
  if (lines.length > 8) errs.push('at most 8 lines (set more: true and cut)')
  const chips = Array.isArray(card.chips) ? card.chips : []
  if (chips.length > 4) errs.push('at most 4 chips')
  const long = chips.filter(c => String(c?.label || '').length > CHIP_MAX).map(c => c.label)
  if (long.length) errs.push(`chip labels over ${CHIP_MAX} characters, shorten them: ${long.join(', ')}`)
  for (const c of chips) {
    const kinds = ['send', 'url', 'input'].filter(k => typeof c?.[k] === 'string' && c[k])
    if (kinds.length !== 1) errs.push(`chip "${c?.label}" needs exactly one of send, url, input`)
    if (c?.url && !/^https:\/\//.test(c.url)) errs.push(`chip "${c.label}" url must be https`)
  }
  return errs
}

export function cardBody(card) {
  return {
    title: clean(card.title, 60),
    lines: (card.lines || []).slice(0, 8).map(l => clean(l, 120)),
    chips: (card.chips || []).slice(0, 4).map(c => ({ label: clean(c.label, CHIP_MAX), ...(c.send ? { send: clean(c.send, 500) } : c.url ? { url: c.url } : { input: clean(c.input, 120) }) })),
    more: !!card.more,
    at: Date.now(),
  }
}

// Skill frontmatter: "requires: [gmail, calendar]" and "tile: TRIAGE". Missing requires = base tile, always live.
export function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---/.exec(md)
  const out = {}
  if (!m) return out
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].trim()
  }
  return out
}

export function requiresOf(fm) {
  const v = fm.requires || ''
  return v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

// skills: [{name, tile, requires}], caps: ['calendar', ...] -> live tiles, and locked ones ranked by how few connections they need.
export function tiles(skills, caps) {
  const have = new Set(caps.map(c => c.toLowerCase()))
  const live = [], locked = []
  for (const s of skills) {
    if (!s.tile) continue
    const needs = s.requires.filter(r => !have.has(r))
    if (needs.length) locked.push({ tile: s.tile, needs })
    else live.push(s.tile)
  }
  locked.sort((a, b) => a.needs.length - b.needs.length || a.tile.localeCompare(b.tile))
  // What each missing connection would add, so the UNLOCK tile can rank connections by payoff.
  const unlocks = {}
  for (const l of locked) if (l.needs.length === 1) (unlocks[l.needs[0]] ||= []).push(l.tile)
  return { live, locked, unlocks }
}

// What the phone draws: live tiles in skill order, plus UNLOCK when something is locked. UNLOCK is a pick flow, one
// option per missing connection with the tiles it would open; picking one sends "/unlock <id>" to the session.
export function phoneFlows(t) {
  const adds = {}
  for (const l of t.locked) for (const n of l.needs) (adds[n] ||= []).push(l.tile)
  const ids = Object.keys(adds).sort((a, b) => adds[b].length - adds[a].length || a.localeCompare(b))
  const tiles = t.live.map(x => x.toLowerCase())
  const flows = {}
  if (ids.length) {
    tiles.push('unlock')
    flows.unlock = { title: 'UNLOCK', steps: [{ type: 'pick', title: 'CONNECT WHAT?', options: ids.map(id => ({ label: id.toUpperCase(), value: id, sub: adds[id].join(' · ') })) }] }
  }
  return { tiles, flows }
}

// First live step for a tap: "Picked up TODAY" for a tile command, "Reading your message" for typed text.
export function pickedUp(content) {
  const m = /^\/([a-z-]{2,20})\b/.exec(String(content || ''))
  return m ? `Picked up ${m[1].toUpperCase()}` : 'Reading your message'
}

// Live status for the phone's waiting card. Same body status.py sends: {now, steps, times, mode, end?}.
export class Status {
  constructor(clock = () => Date.now()) { this.clock = clock; this.reset() }
  reset() { this.now = ''; this.steps = []; this.times = []; this.since = 0; this.mode = 'idle'; this.end = 0; this.eta = 0 }
  set(step, eta) {
    step = clean(step, 80)
    if (!this.now || this.mode === 'idle') { this.steps = []; this.times = []; this.end = 0; this.eta = 0 }
    if (this.now && this.mode !== 'idle' && this.now !== step) { this.steps.push(this.now); this.times.push(this.since) }
    if (eta) this.eta = Number(eta) || 0
    this.now = step; this.since = this.clock(); this.mode = 'active'
    return this.body()
  }
  wait(what) {
    if (this.now && this.mode === 'active') { this.steps.push(this.now); this.times.push(this.since) }
    this.now = clean(what, 80); this.since = this.clock(); this.mode = 'approval'
    return this.body()
  }
  done(task) {
    if (this.now && this.mode === 'active') { this.steps.push(this.now); this.times.push(this.since) }
    this.now = clean(task, 80); this.end = this.clock(); this.mode = 'idle'
    return this.body()
  }
  body() {
    const times = this.mode === 'idle' ? this.times : [...this.times, this.since]
    // The phone's wire names (same as Ed's status.py): active, waiting, done.
    const mode = { approval: 'waiting', idle: 'done' }[this.mode] || this.mode
    return { now: this.now, steps: this.steps.slice(-8), times: times.slice(-9), mode, ...(this.eta ? { eta: this.eta } : {}), ...(this.end ? { end: this.end } : {}) }
  }
}
