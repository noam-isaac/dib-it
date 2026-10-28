import assert from "node:assert/strict"
import { chromium, firefox, webkit } from "playwright"
import { createServer } from "vite"
import { prepareAnnualFeed } from "./annual-fixture.mjs"

const engine = process.env.DIBIT_BROWSER ?? "chromium"
const ids = ["11111111", "22222222", "33333333"]
const catalog = Object.fromEntries(ids.map((id, index) => [id, {
  name: `קורס ${index + 1}`,
  groups: ["01", "02"].map(group => ({ group, lessons: [{ day: "א", time: "08:00-10:00", type: "שיעור" }] })),
}]))
const initial = {
  semester: "2026a", tab: "schedule", theme: "apple", activePlanId: "first",
  plans: [
    { id: "first", name: "First plan", courses: { "2026a": ids.map(id => ({ id, groups: ["01"] })) } },
    { id: "second", name: "Second plan", courses: { "2026a": [{ id: ids[2], groups: ["02"] }] } },
  ],
}
const server = await createServer({
  // Negative control: prove the first race fails if callbacks evaluate a rendered snapshot.
  plugins: process.env.DIBIT_STALE_SNAPSHOT === "1" ? [{
    name: "stale-snapshot-negative-control", enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/models.ts")) return
      const boundary = "updateDibIt(change, workspace.activePlanId, workspace.semester)"
      assert.ok(code.includes(boundary))
      return code.replace(boundary, "updateDibIt(() => change(activePlanView(workspace)), workspace.activePlanId, workspace.semester)")
    },
  }] : [],
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  server: { host: "127.0.0.1", port: 0 },
})
const read = page => page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")))
const selected = workspace => workspace.plans.find(plan => plan.id === workspace.activePlanId).courses["2026a"]
const groups = (workspace, id) => selected(workspace).find(course => course.id === id)?.groups
const checkbox = (page, id, group) => page.locator(`#course-${id}`).getByRole("checkbox", { name: `קבוצה ${group}`, exact: true })
const settings = page => page.getByRole("button", { name: "הגדרות", exact: true }).click()
const plans = async page => {
  await page.getByRole("button", { name: "פעולות", exact: true }).click()
  await page.getByRole("menuitem", { name: "מערכות שעות", exact: true }).click()
  await page.locator("#schedule-selector").waitFor()
}
const switchPlan = async (page, name) => {
  await plans(page)
  await page.locator("#schedule-selector").click()
  await page.getByRole("option", { name, exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
}
let browser
try {
  await server.listen()
  browser = await ({ chromium, firefox, webkit })[engine].launch()
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.route("**/*", route => {
      const url = new URL(route.request().url())
      if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
      const filename = url.pathname.split("/").pop()
      return route.fulfill({ json: filename === "info.json"
        ? { currentSemester: "2026a", semesters: { "2026a": {}, "2026b": {} } }
        : filename.startsWith("courses-") ? catalog : {} })
    })
    const page = await context.newPage()
    const other = await context.newPage()
    const errors = []
    for (const target of [page, other]) {
      target.on("pageerror", error => errors.push(error.message))
      await prepareAnnualFeed(target)
      await target.addInitScript(initial => {
        localStorage.setItem("Dib It Fork Intro Seen", "true")
        if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify(initial))
        globalThis.__heldStorage = []
        globalThis.__delayStorage = false
        window.addEventListener("storage", event => {
          if (globalThis.__delayStorage && event.key === "Dib It") {
            event.stopImmediatePropagation()
            globalThis.__heldStorage.push(event)
          }
        }, true)
      }, initial)
    }
    const url = `http://127.0.0.1:${server.httpServer.address().port}`
    await page.goto(url)
    await other.goto(url)
    const ready = async target => {
      await checkbox(target, ids[0], "01").waitFor()
      await target.waitForFunction(ids => ids.every(id => {
        const card = document.querySelector(`#course-${id}`)
        const inputs = card?.querySelectorAll('input[type="checkbox"]')
        return inputs?.[0]?.checked && !inputs[1]?.checked
      }) && !document.querySelector("#export-content input[type=file]"), ids)
    }
    await ready(page)
    await ready(other)
    const reset = async () => {
      await page.evaluate(initial => {
        globalThis.__delayStorage = false
        globalThis.__heldStorage = []
        const serialized = JSON.stringify(initial)
        localStorage.setItem("Dib It", serialized)
        window.dispatchEvent(new StorageEvent("storage", { key: "Dib It", newValue: serialized }))
      }, initial)
      await ready(page)
      await ready(other)
    }
    const hold = () => page.evaluate(() => { globalThis.__heldStorage = []; globalThis.__delayStorage = true })
    const delivered = () => page.waitForFunction(() => globalThis.__heldStorage.some(event => event.storageArea !== null))
    const flush = () => page.evaluate(() => {
      globalThis.__delayStorage = false
      // Fresh events clear the original capture-phase stop flags before delivery.
      globalThis.__heldStorage.splice(0).forEach(event => window.dispatchEvent(new StorageEvent("storage", {
        key: event.key, newValue: event.newValue, storageArea: event.storageArea, url: event.url,
      })))
    })

    // Real page B writes are visible in localStorage while page A still renders old data.
    await hold()
    await checkbox(other, ids[0], "02").check()
    await delivered()
    assert.equal(await checkbox(page, ids[0], "02").isChecked(), false)
    await checkbox(page, ids[0], "01").click()
    assert.deepEqual(groups(await read(page), ids[0]), ["02"], "stale deselection preserves another tab's newly selected group")
    await flush()
    await page.waitForFunction(id => document.querySelectorAll(`#course-${id} input[type=checkbox]`)[1]?.checked, ids[0])
    assert.equal(await checkbox(page, ids[0], "02").isChecked(), true)

    // Both handlers run before a React render; each edit still composes with the first.
    await reset()
    await page.evaluate(ids => {
      ids.slice(0, 2).forEach(id => document.querySelectorAll(`#course-${id} input[type=checkbox]`)[1].click())
      Array.from(document.querySelectorAll("button")).find(button => button.textContent === "הגדרות").click()
    }, ids)
    const rapid = await read(page)
    assert.deepEqual(groups(rapid, ids[0]), ["01", "02"])
    assert.deepEqual(groups(rapid, ids[1]), ["01", "02"])
    assert.equal(rapid.tab, "settings")

    // A removed course's stale color/reorder controls cannot recreate it or touch its successor.
    for (const edit of ["color", "reorder"]) {
      await reset()
      await hold()
      await other.locator(`#course-${ids[1]}`).getByRole("button", { name: "הסרת הקורס", exact: true }).click()
      await delivered()
      const before = await read(page)
      assert.equal(await page.locator(`#course-${ids[1]}`).getByRole("textbox").count(), 1, "the stale color control is still rendered before delivery")
      if (edit === "color") await page.locator(`#course-${ids[1]}`).getByRole("textbox").fill("#112233")
      else await page.locator(`#course-${ids[1]}`).getByRole("button", { name: "הזזת הקורס למעלה", exact: true }).click()
      assert.deepEqual(await read(page), before, `stale ${edit} cannot change the remaining saved courses`)
      await flush()
      await page.locator(`#course-${ids[1]}`).waitFor({ state: "hidden" })
    }

    await reset()
    await hold()
    await switchPlan(other, "Second plan")
    await delivered()
    const switched = await read(page)
    await checkbox(page, ids[0], "02").click()
    assert.deepEqual(await read(page), switched, "stale controls from the previous plan are rejected")
    await flush()
    await page.locator(`#course-${ids[0]}`).waitFor({ state: "hidden" })
    assert.deepEqual(groups(await read(page), ids[2]), ["02"])

    // Hold actual File.text() completion, then navigate/delete via the real plan picker.
    for (const action of ["switch", "delete"]) {
      await reset()
      await settings(page)
      await page.evaluate(() => {
        const original = File.prototype.text
        File.prototype.text = function () {
          const file = this
          globalThis.__fileStarted = true
          return new Promise(resolve => { globalThis.__releaseFile = () => original.call(file).then(resolve) })
        }
      })
      await page.locator("#export-content input[type=file]").setInputFiles({ name: "late.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(catalog)) })
      await page.waitForFunction(() => globalThis.__fileStarted)
      if (action === "switch") await switchPlan(page, "Second plan")
      else {
        await plans(page)
        await page.getByRole("button", { name: "מחיקת מערכת השעות", exact: true }).click()
        await page.getByRole("dialog").last().getByRole("button", { name: "מחיקת מערכת השעות", exact: true }).click()
        await page.waitForFunction(() => JSON.parse(localStorage.getItem("Dib It")).activePlanId === "second")
        await page.keyboard.press("Escape")
      }
      const before = await read(page)
      await page.evaluate(async () => { await globalThis.__releaseFile(); await new Promise(requestAnimationFrame) })
      assert.deepEqual(await read(page), before, `late import after plan ${action} cannot write to another plan or shared settings`)
      await page.reload()
      await page.locator(`#course-${ids[2]}`).waitFor()
      assert.equal((await read(page)).customCourses?.["late.json"], undefined)
    }

    await reset()
    const saved = await page.evaluate(() => localStorage.getItem("Dib It"))
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === "Dib It") throw new DOMException("Atomic stress: storage quota exceeded", "QuotaExceededError")
        return original.call(this, key, value)
      }
    })
    await checkbox(page, ids[0], "01").click()
    await page.waitForFunction(id => document.querySelector(`#course-${id} input[type=checkbox]`).checked, ids[0])
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), saved, "failed write keeps saved bytes")
    assert.equal(await checkbox(page, ids[0], "01").isChecked(), true, "failed write keeps the rendered selection")
    await page.getByRole("button", { name: "הגדרות", exact: true }).click()
    assert.equal(await page.locator("#export-content input[type=file]").count(), 0, "failed tab write keeps the rendered screen")
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), saved)
    assert.ok(errors.some(message => message.includes("Atomic stress: storage quota exceeded")), "the failure injection reached the real storage write")
    assert.deepEqual(errors.filter(message => !message.includes("Atomic stress: storage quota exceeded")), [])
    await context.close()
    console.log(`PASS ${engine} ${width}px: delayed two-tab events, rapid controls, stale removals, plan switches/imports and rejected writes`)
  }
} finally {
  await browser?.close()
  await server.close()
}
