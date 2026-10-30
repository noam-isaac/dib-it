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
const initial = {
  semester: '2026a', tab: 'schedule', theme: 'apple', activePlanId: 'first',
  plans: [{ id: 'first', name: 'First plan', courses: { '2026a': ids.map(id => ({ id, groups: ['01'] })) } }],
}
const catalog = Object.fromEntries(ids.map((id, index) => [id, {
  name: `קורס ${index + 1}`,
  groups: ['01', '02'].map(group => ({ group, lessons: [{ day: 'א', time: '08:00-10:00', type: 'שיעור' }] })),
}]))
const selected = value => value.plans[0].courses['2026a'].map(({id,groups}) => ({id,groups}))
const expected = (a, b) => ids.map((id, i) => ({ id, groups: i === 0 && a || i === 1 && b ? ['01', '02'] : ['01'] }))
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), fixture: initial, instrumentation: 'Vite pre-transform adds a guarded debugger statement immediately after getWorkspace() within updateDibIt. The production source on disk is unchanged. Edits use real DOM checkbox click handlers, real getWorkspace and localStorage.setItem.', deterministic: [], natural: {} }

async function run(instrumented) {
  const server = await createServer({ root,
    plugins: instrumented ? [{ name: 'read-write-overlap-probe', enforce: 'pre', transform(code, id) {
      if (!id.endsWith('/src/models.ts')) return
      const marker = 'export const updateDibIt = (update: (current: DibIt) => DibIt, expectedPlanId?: string, editSemester?: string) => {\n  const workspace = getWorkspace()'
      assert.ok(code.includes(marker), 'the exact reviewed updateDibIt read boundary must match')
      return code.replace(marker, marker + '\n  if (globalThis.__probeArmed) { globalThis.__probeArmed = false; debugger; }')
    } }] : [],
    define: { 'import.meta.env.VITE_ENABLE_GOOGLE_SYNC': '"false"' }, server: { host: '127.0.0.1', port: 0 },
  })
  let browser
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
    const errors = []
    for (const page of pages) {
      page.on('pageerror', error => errors.push(error.message))
      await prepareAnnualFeed(page)
      await page.addInitScript(initial => {
        localStorage.setItem('Dib It Fork Intro Seen', 'true')
        if (!localStorage.getItem('Dib It')) localStorage.setItem('Dib It', JSON.stringify(initial))
      }, initial)
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    }
    const ready = () => Promise.all(pages.map(page => page.waitForFunction(ids => ids.every(id => {
      const inputs = document.querySelectorAll(`#course-${id} input[type=checkbox]`)
      return inputs.length === 2 && inputs[0].checked && !inputs[1].checked
    }), ids)))
    const read = page => page.evaluate(() => JSON.parse(localStorage.getItem('Dib It')))
    const reset = async () => {
      await pages[0].evaluate(initial => {
        const value = JSON.stringify(initial)
        localStorage.setItem('Dib It', value)
        window.dispatchEvent(new StorageEvent('storage', { key: 'Dib It', newValue: value }))
      }, initial)
      await ready()
    }
    await ready()
    if (instrumented) {
      const sessions = await Promise.all(pages.map(page => context.newCDPSession(page)))
      await Promise.all(sessions.map(session => session.send('Debugger.enable')))
      for (const lastWriter of [1, 0]) {
        await reset()
        await Promise.all(pages.map(page => page.evaluate(() => { globalThis.__probeArmed = true })))
        const pause = session => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('handler did not reach read boundary')), 15000)
          session.once('Debugger.paused', event => { clearTimeout(timeout); resolve(event) })
        })
        const paused = sessions.map(pause)
        const clicks = pages.map((page, i) => page.evaluate(id => {
          document.querySelectorAll(`#course-${id} input[type=checkbox]`)[1].click()
          return { completed: true, selected: document.querySelectorAll(`#course-${id} input[type=checkbox]`)[1].checked }
        }, ids[i]))
        const pauseEvents = await Promise.all(paused)
        const snapshots = await Promise.all(sessions.map((session, i) => session.send('Debugger.evaluateOnCallFrame', {
          callFrameId: pauseEvents[i].callFrames[0].callFrameId,
          expression: 'JSON.stringify(workspace)', returnByValue: true,
        }).then(result => JSON.parse(result.result.value))))
        assert.deepEqual(snapshots[0], snapshots[1], 'both live handlers read exactly the same starting workspace')
        assert.deepEqual(selected(snapshots[0]), expected(false, false))
        const firstWriter = 1 - lastWriter
        await sessions[firstWriter].send('Debugger.resume')
        const firstResult = await clicks[firstWriter]
        const afterFirst = await read(pages[firstWriter])
        assert.deepEqual(selected(afterFirst), expected(firstWriter === 0, firstWriter === 1), 'first checkbox write succeeds')
        await sessions[lastWriter].send('Debugger.resume')
        const lastResult = await clicks[lastWriter]
        const afterSecond = await read(pages[lastWriter])
        assert.deepEqual(selected(afterSecond), expected(lastWriter === 0, lastWriter === 1), 'second checkbox write overwrites first edit')
        await Promise.all(pages.map(page => page.reload()))
        const reloaded = await Promise.all(pages.map(read))
        assert.deepEqual(reloaded[0], afterSecond)
        assert.deepEqual(reloaded[1], afterSecond)
        report.deterministic.push({ lastWriter: lastWriter === 0 ? 'A' : 'B', bothReadSameWorkspace: true, snapshots, firstResult, lastResult, afterFirst: selected(afterFirst), afterSecond: selected(afterSecond), afterReload: reloaded.map(selected), bothWritesSucceeded: true, lostEdit: firstWriter === 0 ? ids[0] : ids[1], topFrames: pauseEvents.map(event => ({ functionName: event.callFrames[0].functionName, location: event.callFrames[0].location })) })
        console.log(`CONFIRMED controlled overlap, ${lastWriter === 0 ? 'A' : 'B'} writes last: first valid checkbox edit is lost after reload`)
      }
    } else {
      const trials = 200
      const outcomes = []
      for (let trial = 0; trial < trials; trial++) {
        await reset()
        const targetTime = Date.now() + 60
        const completed = await Promise.all(pages.map((page, i) => page.evaluate(({id, targetTime}) => new Promise(resolve => {
          setTimeout(() => {
            document.querySelectorAll(`#course-${id} input[type=checkbox]`)[1].click()
            resolve({ completed: true, time: Date.now() })
          }, Math.max(0, targetTime - Date.now()))
        }), { id: ids[i], targetTime })))
        await new Promise(resolve => setTimeout(resolve, 40))
        const [left, right] = await Promise.all(pages.map(read))
        assert.deepEqual(left, right, 'native storage views agree after a short event-delivery settle')
        const value = selected(left)
        if (JSON.stringify(value) !== JSON.stringify(expected(true, true))) {
          const outcome = { trial, completed, stored: value }
          if (!outcomes.length) {
            await Promise.all(pages.map(page => page.reload()))
            const reloaded = await Promise.all(pages.map(read))
            assert.deepEqual(reloaded[0], left, 'first unchanged-source lost edit remains lost after A reload')
            assert.deepEqual(reloaded[1], left, 'first unchanged-source lost edit remains lost after B reload')
            outcome.afterReload = reloaded.map(selected)
            await pages[0].screenshot({ path: join(outputDir, 'unchanged-source-lost-edit.png'), fullPage: true })
          }
          outcomes.push(outcome)
        }
      }
      report.natural = { trials, lostEditTrials: outcomes.length, outcomes, method: 'Unchanged source, unwrapped native localStorage, no debugger. Two pages each schedule a real DOM checkbox click at the same future wall-clock time. Outcomes are read from both tabs 40ms after both click callbacks complete and asserted identical. The first loss is checked after both pages reload. No storage notifications are suppressed.' }
      console.log(`UNCHANGED SOURCE simultaneous trials: ${outcomes.length}/${trials} lost an edit`)
      if (outcomes.length) {
        await Promise.all(pages.map(page => page.reload()))
      }
    }
    report[instrumented ? 'controlledErrors' : 'naturalErrors'] = errors
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await server.close()
  }
}
try {
  await run(true)
  await run(false)
} finally {
  await writeFile(join(outputDir, 'evidence.json'), JSON.stringify(report, null, 2))
}
