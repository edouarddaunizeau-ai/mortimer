import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'watch.py')

function run(dir, args, env = {}, timeout = 30000) {
  return new Promise(resolve => execFile('python3', ['-I', SCRIPT, ...args], { env: { ...process.env, MORTIMER_DIR: dir, ...env }, timeout },
    (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, out: stdout.trim(), err: stderr.trim() })))
}

function py(code) {
  return new Promise((resolve, reject) => execFile('python3', ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(dirname(SCRIPT))}); import watch\n${code}`], { timeout: 20000 },
    (err, stdout, stderr) => err ? reject(new Error(stderr)) : resolve(stdout.trim())))
}

test('focus words, AND groups and prices', async () => {
  assert.equal(await py('print(watch.parse_focus("a, b; c"))'), "[['a', 'b'], ['c']]")
  assert.equal(await py('print(watch.matches("tickets in london", [["tickets"], ["uk", "london"]]))'), 'True')
  assert.equal(await py('print(watch.matches("tickets in paris", [["tickets"], ["uk", "london"]]))'), 'False')
  assert.equal(await py('print(watch.lowest_price(["from £1,299", "now £89.50", "€120"]))'), '89.5')
  assert.equal(await py('print(watch.html_lines("<head><title>x</title></head><p>One</p><script>var a=1</script><li>Two  words</li>"))'), "['One', 'Two words']")
  assert.equal(await py('print(watch.ok_url("http://example.com"), watch.ok_url("https://example.com"), watch.ok_url("file:///etc/passwd"))'), 'False True False')
})

test('add, check, list and remove against a local page', async () => {
  let page = '<html><body><p>Cookie banner</p><p>Growth lead role</p><p>Sales role</p><p>Price £120</p></body></html>'
  const srv = createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page) })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}/jobs`
  const dir = mkdtempSync(join(tmpdir(), 'ha-watch-'))
  try {
    assert.match((await run(dir, ['add', 'Jobs', url, '--focus', 'growth'])).out, /^1\. Watching Jobs\. Baseline: \d+ lines/)
    assert.match((await run(dir, ['add', 'Price', url, '--focus', 'price', '--below', '100'])).out, /Lowest price now: 120/)
    assert.equal((await run(dir, ['check'])).out, 'No changes.')
    page = page.replace('Growth lead role', 'Growth lead role</p><p>Growth analyst role').replace('£120', '£95')
    const c = await run(dir, ['check'])
    assert.match(c.out, /Jobs changed\. New: .*Growth analyst role/)
    assert.match(c.out, /Price is now 95 \(limit 100\)/)
    assert.match(readFileSync(join(dir, 'alerts.md'), 'utf8'), /Growth analyst role/)
    assert.equal((await run(dir, ['check'])).out, 'No changes.')
    assert.match((await run(dir, ['list'])).out, /1\. Jobs, focus: growth[\s\S]*2\. Price, alert below 100/)
    assert.equal((await run(dir, ['remove', '1'])).out, 'Removed: Jobs')
    assert.notEqual((await run(dir, ['remove', '9'])).code, 0)
    assert.notEqual((await run(dir, ['add', 'Bad', 'http://example.com'])).code, 0)
    assert.ok(existsSync(join(dir, 'watches.json')))
  } finally { srv.close() }
})

// A page whose content only exists after its script runs, like most shop and careers pages.
const JS_PAGE = `<!doctype html><html><head><title>Shop</title></head><body><div id="root"></div>
<noscript>You need to enable JavaScript to run this app.</noscript>
<script>setTimeout(() => { document.getElementById('root').innerHTML =
  '<h1>Winter boots</h1><p>Rendered price £75</p><p>Only 3 left in stock</p>' }, 200)</script></body></html>`
const RENDER = join(dirname(SCRIPT), 'render.mjs')

function renderAvailable() {
  return new Promise(resolve => execFile('node', [RENDER, 'https://example.invalid/'], { timeout: 60000 }, (err) => resolve(!err || err.code !== 3)))
}

test('auto render: JS shell detected, rendered in Chromium, or raw fallback with a reason', { timeout: 200000 }, async (t) => {
  const srv = createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(JS_PAGE) })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}/boots`
  try {
    assert.equal(await py(`html = ${JSON.stringify(JS_PAGE)}\nprint(watch.looks_like_js_shell(html, watch.html_lines(html)))`), 'True')
    assert.equal(await py('print(watch.looks_like_js_shell("<p>tiny static page</p>", ["tiny static page"]))'), 'False')

    // Renderer forced unavailable: raw HTML is used, the check says why, nothing crashes.
    const dir = mkdtempSync(join(tmpdir(), 'ha-watch-'))
    const missing = { MORTIMER_RENDERER: join(dir, 'no-such-render.mjs') }
    const add = await run(dir, ['add', 'Boots', url, '--focus', 'price'], missing)
    assert.equal(add.code, 0, add.err)
    assert.match(add.out, /Note: could not render in Chromium \(renderer not found at .*no-such-render\.mjs\), used raw HTML\./)
    assert.match(add.out, /nothing is in focus yet/)
    const chk = await run(dir, ['check'], missing)
    assert.equal(chk.code, 0, chk.err)
    assert.match(chk.out, /Note: Boots: could not render in Chromium \(renderer not found/)
    assert.match((await run(dir, ['list'], missing)).out, /\[problem: nothing in focus/)

    // never: no render attempt, no note.
    const dirN = mkdtempSync(join(tmpdir(), 'ha-watch-'))
    const never = await run(dirN, ['add', 'Raw', url, '--render', 'never'], missing)
    assert.doesNotMatch(never.out, /Note:/)
    assert.notEqual((await run(dirN, ['add', 'Bad', url, '--render', 'sometimes'])).code, 0)

    if (!(await renderAvailable())) {
      t.diagnostic('SKIPPED render assertion: Playwright or Chromium not available on this machine')
      return
    }
    const dir2 = mkdtempSync(join(tmpdir(), 'ha-watch-'))
    const r = await run(dir2, ['add', 'Boots', url, '--focus', 'price', '--below', '100'], {}, 120000)
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /Lowest price now: 75/)
    const saved = JSON.parse(readFileSync(join(dir2, 'watches.json'), 'utf8'))[0]
    assert.equal(saved.needs_render, true)
    assert.match(saved.last, /Rendered price £75/)
    assert.match((await run(dir2, ['list'])).out, /rendered in Chromium/)
    assert.match((await run(dir2, ['peek', '1'], {}, 120000)).out, /Rendered price £75/)
  } finally { srv.close() }
})
