// PreToolUse guard for Bash: asks for what needs the user, denies what must never run, stays silent otherwise.
// A small, generic port of Ed's bin/bash-guard.py. Fails closed: unreadable input means ask.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const say = (decision, reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }))

// Each rule: [decision, pattern, plain reason of at most 12 words]. First match wins; deny rules come first.
export const RULES = [
  ['deny', /(^|[;&|(]\s*|\s)(sudo|su|doas)\s/, 'Admin rights are never used by the agent'],
  ['deny', /\bgit\s+push\b[^;&|]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, 'Force pushes can destroy history and are blocked'],
  ['deny', /(^|[;&|]\s*)(env|printenv|export\s+-p|set)\s*($|[;&|>])/, 'Dumping the environment could expose secrets'],
  ['deny', /\.mortimer\/link\.env/, 'The phone pairing key file is never read or printed'],
  ['ask', /\bvercel\b[^;&|]*\s(--prod\b|promote\b)/, 'Production deploy to a public site'],
  ['ask', /\b(netlify\s+deploy[^;&|]*--prod|fly\s+deploy|firebase\s+deploy|railway\s+up)\b/, 'Production deploy to a public site'],
  ['ask', /\bsupabase\s+(db\s+(push|reset)|migration\s+up)\b/, 'Database change on a live project'],
  ['ask', /\b(vercel\s+(remove|rm|project\s+rm)|gh\s+repo\s+delete|vercel\s+dns\s+rm)\b/, 'Deletes a project, repo or DNS record'],
  ['ask', /\bgit\s+push\b[^;&|]*\b(main|master)\b/, 'Push to the main branch'],
  ['ask', /\bcrontab\b/, 'Changes scheduled jobs on this machine'],
  ['ask', /\b(stripe|paypal)\b[^;&|]*\b(charges?|payments?|payouts?)\s+create\b/, 'Payment or purchase'],
]

const RM_OK = [join(HOME, 'builds'), join(HOME, '.mortimer'), '/tmp']

export function decide(cmd, offLimits = []) {
  for (const p of offLimits) if (p && cmd.includes(p)) return ['deny', 'Touches something the user marked off-limits']
  for (const [d, re, why] of RULES) if (re.test(cmd)) return [d, why]
  const rm = /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b\s+([^;&|]+)/.exec(cmd)
  if (rm) {
    const targets = rm[2].trim().split(/\s+/).filter(t => !t.startsWith('-')).map(t => t.replace(/^~(?=\/|$)/, HOME))
    // Relative paths stay inside the working folder unless they climb out with "..".
    const risky = t => t.includes('..') || t === '.' || t === '*' || (t.startsWith('/') && !RM_OK.some(r => t === r || t.startsWith(r + '/')))
    if (targets.some(risky)) return ['ask', 'Recursive delete outside the build folders']
  }
  return null
}

// Off-limits paths: lines in profile.md under "Off-limits" that look like paths.
function offLimits() {
  try {
    const p = readFileSync(join(process.env.MORTIMER_DIR || join(HOME, '.mortimer'), 'profile.md'), 'utf8')
    return [...p.matchAll(/(?:^|\s)(~?\/[\w.\-/]+)/g)].map(m => m[1].replace(/^~/, HOME)).filter(x => x.length > 3)
  } catch { return [] }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'))
    const r = decide(String(input?.tool_input?.command ?? ''), offLimits())
    if (r) say(r[0], r[1])
  } catch {
    say('ask', 'Safety check failed, please review this command')
  }
}
