import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { decide } from '../hooks/guard.mjs'

const d = c => decide(c)?.[0] ?? 'allow'

test('guard decisions', () => {
  assert.equal(d('ls -la'), 'allow')
  assert.equal(d('sudo apt install x'), 'deny')
  assert.equal(d('git push --force origin main'), 'deny')
  assert.equal(d('printenv'), 'deny')
  assert.equal(d('cat ~/.mortimer/link.env'), 'deny')
  assert.equal(d('vercel deploy --prod --yes'), 'ask')
  assert.equal(d('vercel deploy --yes'), 'allow')
  assert.equal(d('git push origin main'), 'ask')
  assert.equal(d('git push origin feature-x'), 'allow')
  assert.equal(d('crontab -l'), 'ask')
  assert.equal(d('rm -rf ~/builds/old-site'), 'allow')
  assert.equal(d('rm -rf /tmp/x'), 'allow')
  assert.equal(d('rm -rf ~/Documents'), 'ask')
  assert.equal(d('rm -rf node_modules'), 'allow')
  assert.equal(d('supabase db push'), 'ask')
  assert.equal(d('rm -rf ../other'), 'ask')
  assert.equal(d('rm -rf /'), 'ask')
  assert.equal(decide('cat /srv/work/report.pdf', ['/srv/work'])[0], 'deny')
})

test('guard fails closed on bad input', () => {
  const out = execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard.mjs')], { input: 'not json' }).toString()
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'ask')
})

test('guard prints nothing for an allowed command', () => {
  const out = execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard.mjs')], { input: JSON.stringify({ tool_input: { command: 'ls' } }), env: { ...process.env, MORTIMER_DIR: '/nonexistent' } }).toString()
  assert.equal(out, '')
})
