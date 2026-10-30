import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { prepareAnnualFeed } from "./annual-fixture.mjs"

const ids = ["11111111", "22222222"]
const initial = { semester: "2026a", tab: "schedule", activePlanId: "first", plans: [{ id: "first", name: "בדיקת תיאום", courses: { "2026a": ids.map(id => ({ id, groups: [] })) } }] }
const catalog = Object.fromEntries(ids.map((id, i) => [id, { name: `קורס ${i + 1}`, groups: [{ group: "01", lessons: [] }] }]))
const server = await createServer({ define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' }, server: { host: "127.0.0.1", port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const context = await browser.newContext()
  await context.route("**/*", route => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
    return route.fulfill({ json: url.pathname.endsWith("info.json") ? { currentSemester: "2026a", semesters: { "2026a": {} } } : url.pathname.includes("courses-") ? catalog : {} })
  })
  const pages = await Promise.all([context.newPage(), context.newPage()])
  const errors = []
  for (const page of pages) {
    page.on("pageerror", error => errors.push(error.message))
    await prepareAnnualFeed(page)
    await page.addInitScript(initial => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify(initial))
    }, initial)
  }
  const url = `http://127.0.0.1:${server.httpServer.address().port}`
  await Promise.all(pages.map(page => page.goto(url)))
  const [a, b] = pages
  const read = () => a.evaluate(async () => (await (await import("/src/workspaceStore.ts")).captureWorkspace()))
  const reset = async () => {
    await a.evaluate(async initial => (await import("/src/models.ts")).setWorkspace(initial), initial)
    await Promise.all(pages.map(page => page.waitForFunction(ids => ids.every(id => {
      const checkbox = document.querySelector(`#course-${id} input[type=checkbox]`)
      return checkbox && !checkbox.checked
    }), ids)))
  }
  // Native localStorage, native Web Locks, actual checkbox handlers, independent pages.
  // These deliberately simultaneous trials are a stress test, not an ordinary-use probability.
  for (let trial = 0; trial < 200; trial++) {
    await reset()
    const at = Date.now() + 25
    await Promise.all(pages.map((page, i) => page.evaluate(({ id, at }) => new Promise(resolve => setTimeout(() => {
      document.querySelector(`#course-${id} input[type=checkbox]`).click()
      resolve()
    }, Math.max(0, at - Date.now()))), { id: ids[i], at })))
    const saved = (await read()).workspace.plans[0].courses["2026a"]
    assert.deepEqual(saved.map(course => course.groups), [["01"], ["01"]], `trial ${trial}: both handlers must survive`)
  }
  await a.reload()
  assert.deepEqual((await read()).workspace.plans[0].courses["2026a"].map(course => course.groups), [["01"], ["01"]])

  // A background catalog write and plan-management write compete with a real checkbox.
  await reset()
  await Promise.all([
    a.locator(`#course-${ids[0]} input[type=checkbox]`).click(),
    b.evaluate(async () => {
      const { updateWorkspace, reconcileCatalogs } = await import("/src/models.ts")
      await Promise.all([reconcileCatalogs(), updateWorkspace(workspace => ({ ...workspace, plans: workspace.plans.map(plan => ({ ...plan, name: "נשמר ברקע" })) }))])
    }),
  ])
  assert.equal((await read()).workspace.plans[0].name, "נשמר ברקע")
  assert.deepEqual((await read()).workspace.plans[0].courses["2026a"][0].groups, ["01"])

  // Cloud application waits for a local lock, then checks the state again inside it.
  const expected = await read()
  await b.evaluate(async () => {
    const { WORKSPACE_LOCK } = await import("/src/workspaceStore.ts")
    void navigator.locks.request(WORKSPACE_LOCK, () => new Promise(resolve => { window.releaseLock = resolve }))
  })
  await b.waitForFunction(() => !!window.releaseLock)
  const edit = a.evaluate(async () => (await import("/src/models.ts")).updateWorkspace(workspace => ({ ...workspace, theme: "google" })))
  await a.waitForFunction(async () => (await navigator.locks.query()).pending.length === 1)
  const delayed = a.evaluate(async expected => {
    const { acceptCloud } = await import("/src/workspaceStore.ts")
    return acceptCloud(expected, "test", { ...expected.workspace, theme: "apple" }, 2, 123, "download")
  }, expected)
  await a.waitForFunction(async () => (await navigator.locks.query()).pending.length === 2)
  await b.evaluate(() => window.releaseLock())
  await edit
  assert.equal(await delayed, false)
  assert.equal((await read()).workspace.theme, "google")
  assert.equal((await read()).sync, undefined)

  // Closing a lock holder releases the browser lock; a waiting real edit completes.
  await b.evaluate(async () => {
    const { WORKSPACE_LOCK } = await import("/src/workspaceStore.ts")
    window.releaseLock = null
    void navigator.locks.request(WORKSPACE_LOCK, () => new Promise(() => { window.holdingLock = true }))
  })
  await b.waitForFunction(() => window.holdingLock)
  await a.locator(`#course-${ids[1]} input[type=checkbox]`).click()
  await a.waitForFunction(async () => (await navigator.locks.query()).pending.length > 0)
  await b.close()
  assert.deepEqual((await read()).workspace.plans[0].courses["2026a"][1].groups, ["01"])

  const saved = await a.evaluate(() => localStorage.getItem("Dib It Workspace v2"))
  await a.evaluate(() => {
    const original = Storage.prototype.setItem
    window.recoverStorage = () => { Storage.prototype.setItem = original }
    Storage.prototype.setItem = function(key, value) {
      if (key === "Dib It Workspace v2") throw new DOMException("Test quota exceeded", "QuotaExceededError")
      return original.call(this, key, value)
    }
  })
  await a.locator(`#course-${ids[0]} input[type=checkbox]`).click()
  await a.getByText("Test quota exceeded", { exact: true }).waitFor()
  assert.equal(await a.evaluate(() => localStorage.getItem("Dib It Workspace v2")), saved)
  await a.evaluate(async () => {
    window.recoverStorage()
    await (await import("/src/models.ts")).updateWorkspace(workspace => ({ ...workspace, theme: "apple" }))
  })
  assert.equal((await read()).workspace.theme, "apple", "a failed save releases the lock")

  const beforeLegacy = await read()
  await a.evaluate(initial => {
    localStorage.setItem("Dib It", JSON.stringify({ ...initial, theme: "google" }))
    window.dispatchEvent(new StorageEvent("storage", { key: "Dib It" }))
  }, initial)
  await a.getByRole("button", { name: "הורדת העותק מהלשונית הישנה", exact: true }).waitFor()
  assert.deepEqual(await read(), beforeLegacy, "older tabs cannot overwrite the coordinated namespace")
  assert.deepEqual(errors, [])

  // Unsupported browsers retain readable/exportable legacy data and refuse all writes.
  const unsupported = await browser.newContext()
  await unsupported.route("**/*", route => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
    return route.fulfill({ json: url.pathname.endsWith("info.json") ? { currentSemester: "2026a", semesters: { "2026a": {} } } : url.pathname.includes("courses-") ? catalog : {} })
  })
  const old = await unsupported.newPage()
  await prepareAnnualFeed(old)
  await old.addInitScript(initial => {
    Object.defineProperty(navigator, "locks", { value: undefined })
    localStorage.setItem("Dib It", JSON.stringify(initial))
    localStorage.setItem("Dib It Fork Intro Seen", "true")
  }, initial)
  await old.goto(url)
  await old.getByText(/מצב צפייה בלבד/).waitFor()
  assert.equal(await old.evaluate(async () => {
    try { await (await import("/src/models.ts")).updateDibIt(value => ({ ...value, theme: "apple" })); return false } catch { return localStorage.getItem("Dib It Workspace v2") === null }
  }), true)
  assert.deepEqual(await old.evaluate(async () => JSON.parse((await import("/src/workspaceStore.ts")).workspaceRecoveryData())), initial)
  await unsupported.close()
  await context.close()
  console.log("PASS: 200/200 simultaneous real checkbox trials, competing background writers, delayed cloud apply, lock-holder closure, quota recovery, old-tab isolation and unsupported-browser refusal")
} finally { await browser?.close(); await server.close() }
