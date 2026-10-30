// Optional investigation probe; excluded from the normal test pipeline.
// See docs/pr35-handoff.md for scope, expected results, and limitations.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { prepareAnnualFeed } from '../../tests/browser/annual-fixture.mjs'

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)))
const outputDir = await mkdtemp(join(tmpdir(), 'dibit-concurrent-writes-'))
console.log('Diagnostic output:', outputDir)
const ids = ['11111111', '22222222', '33333333']
const initial = { semester: '2026a', tab: 'schedule', theme: 'apple', activePlanId: 'first', plans: [{ id: 'first', name: 'First plan', courses: { '2026a': ids.map(id => ({ id, groups: ['01'] })) } }] }
const catalog = Object.fromEntries(ids.map((id, index) => [id, { name: `קורס ${index + 1}`, groups: ['01', '02'].map(group => ({ group, lessons: [{ day: 'א', time: '08:00-10:00', type: 'שיעור' }] })) }]))
const selected = value => value.plans[0].courses['2026a'].map(({id,groups}) => ({id,groups}))
const expected = ids.map((id, index) => ({id, groups: index < 2 ? ['01', '02'] : ['01']}))
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  instrumentation: 'Temporary Vite pre-transform wraps the entire existing updateDibIt body (including getWorkspace, expectedPlanId check, derive, and setLocalStorage) in navigator.locks.request("Dib It probe workspace edit", callback), assigns that returned Promise to globalThis.__probeCompletion, and returns it. No repository source edits. Actual DOM checkbox handlers and actual native localStorage are used.',
  trials: 200, losses: [], trialsCompleted: 0,
}
const server = await createServer({ root,
  plugins: [{ name: 'whole-update-weblock-counterfactual', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/models.ts')) return
    const start = code.indexOf('export const updateDibIt = ')
    const end = code.indexOf('\n\nexport const useWorkspace', start)
    assert.ok(start >= 0 && end > start)
    const original = code.slice(start, end)
    assert.ok(original.includes('const workspace = getWorkspace()') && original.endsWith('\n}'))
    const transformed = original.replace('=> {\n', '=> {\n  const completion = navigator.locks.request("Dib It probe workspace edit", () => {\n').slice(0, -2) + '\n  })\n  globalThis.__probeCompletion = completion\n  return completion\n}'
    return code.slice(0, start) + transformed + code.slice(end)
  } }],
  define: { 'import.meta.env.VITE_ENABLE_GOOGLE_SYNC': '"false"' }, server: { host: '127.0.0.1', port: 0 },
})
let browser
const errors = []
const started = Date.now()
try {
  await server.listen()
  browser = await chromium.launch()
  report.browser = { engine: 'chromium', version: browser.version(), playwright: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).devDependencies.playwright, node: process.version, platform: process.platform, headless: true }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/data/')) return route.continue()
    const filename = url.pathname.split('/').pop()
    return route.fulfill({ json: filename === 'info.json' ? { currentSemester: '2026a', semesters: { '2026a': {}, '2026b': {} } } : filename.startsWith('courses-') ? catalog : {} })
  })
  const pages = [await context.newPage(), await context.newPage()]
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message))
    await prepareAnnualFeed(page)
    await page.addInitScript(initial => {
      localStorage.setItem('Dib It Fork Intro Seen', 'true')
      if (!localStorage.getItem('Dib It')) localStorage.setItem('Dib It', JSON.stringify(initial))
    }, initial)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  }
  report.apiAvailable = await Promise.all(pages.map(page => page.evaluate(() => ({ secureContext: isSecureContext, request: typeof navigator.locks?.request }))))
  assert.deepEqual(report.apiAvailable, [{secureContext:true,request:'function'},{secureContext:true,request:'function'}])
  const ready = () => Promise.all(pages.map(page => page.waitForFunction(ids => ids.every(id => {
    const inputs = document.querySelectorAll(`#course-${id} input[type=checkbox]`)
    return inputs.length === 2 && inputs[0].checked && !inputs[1].checked
  }), ids)))
  const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('Dib It')))
  await ready()
  await Promise.all(pages.map(page => page.evaluate(async () => { await globalThis.__probeCompletion })))
  for (let trial = 0; trial < report.trials; trial++) {
    await pages[0].evaluate(initial => {
      const value = JSON.stringify(initial)
      localStorage.setItem('Dib It', value)
      window.dispatchEvent(new StorageEvent('storage', {key: 'Dib It', newValue: value}))
    }, initial)
    await ready()
    const targetTime = Date.now() + 60
    const completed = await Promise.all(pages.map((page, index) => page.evaluate(({ id, targetTime }) => new Promise((resolve, reject) => {
      setTimeout(() => {
        document.querySelectorAll(`#course-${id} input[type=checkbox]`)[1].click()
        const completion = globalThis.__probeCompletion
        if (!(completion instanceof Promise)) return reject(new Error('real handler did not expose lock completion promise'))
        completion.then(() => resolve({completed: true, time: Date.now()}), reject)
      }, Math.max(0, targetTime - Date.now()))
    }), {id: ids[index], targetTime})))
    const snapshots = await Promise.all(pages.map(read))
    const actual = snapshots.map(selected)
    if (actual.some(value => JSON.stringify(value) !== JSON.stringify(expected))) report.losses.push({trial, completed, actual})
    assert.deepEqual(actual, [expected, expected], 'both edits must persist after both lock completion promises resolve')
    if (trial === 0 || trial === report.trials - 1) {
      await Promise.all(pages.map(page => page.reload()))
      const afterReload = (await Promise.all(pages.map(read))).map(selected)
      assert.deepEqual(afterReload, [expected, expected], 'both edits must survive both reloads')
      report[trial === 0 ? 'firstReload' : 'lastReload'] = { trial, completed, afterReload }
    }
    report.trialsCompleted++
  }
  assert.deepEqual(errors, [])
  console.log(`WEB LOCK COUNTERFACTUAL: ${report.losses.length}/${report.trialsCompleted} lost edits; both edits survive first and last trial reloads`)
} catch(error) {
  report.failure = String(error.stack || error)
  throw error
} finally {
  report.errors = errors
  report.elapsedMs = Date.now() - started
  await writeFile(join(outputDir, 'lock-counterfactual-evidence.json'), JSON.stringify(report, null, 2))
  await browser?.close()
  await server.close()
}
