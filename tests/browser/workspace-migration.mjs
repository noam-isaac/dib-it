import assert from "node:assert/strict"
import { chromium, firefox, webkit } from "playwright"
import { createServer } from "vite"
import { prepareAnnualFeed } from "./annual-fixture.mjs"

const engine = process.env.DIBIT_BROWSER ?? "chromium"
const recoveryKey = "Dib It Migration Recovery"
const course = { id: "12345678", groups: ["01"] }
const initial = {
  semester: "2026b", tab: "schedule", theme: "apple", activePlanId: "first",
  note: { preserve: "workspace metadata" },
  plans: [{ id: "first", name: "מערכת מקורית", semester: "2026a", tab: { obsolete: true },
    note: { preserve: "plan metadata" }, courses: { "2026a": [course], "2026b": [course] } }],
}
const catalog = { "12345678": { name: "קורס בדיקת המרה", groups: ["01", "02"].map(group => ({ group, lessons: [] })) } }
const server = await createServer({
  cacheDir: "node_modules/.vite-workspace-migration",
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  server: { host: "127.0.0.1", port: 0 },
})
let browser
const raw = page => page.evaluate(() => localStorage.getItem("Dib It"))
const stored = async page => JSON.parse(await raw(page))
const checkbox = (page, group) => page.locator("#course-12345678").getByRole("checkbox", { name: `קבוצה ${group}`, exact: true })
const downloadText = async pending => {
  const chunks = []
  for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk)
  return Buffer.concat(chunks).toString()
}
const open = async (seed, width = 390) => {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await context.route("**/*", route => {
    const url = new URL(route.request().url())
    if (url.hostname !== "127.0.0.1") return route.abort()
    if (!url.pathname.startsWith("/data/")) return route.continue()
    return route.fulfill({ json: url.pathname.endsWith("info.json")
      ? { currentSemester: "2026b", semesters: { "2026a": {}, "2026b": {} } }
      : url.pathname.includes("courses-") ? catalog : {} })
  })
  await prepareAnnualFeed(page)
  await page.addInitScript(seed => {
    if (sessionStorage.getItem("migration-seeded")) return
    sessionStorage.setItem("migration-seeded", "true")
    Object.entries({ "Dib It Fork Intro Seen": "true", ...seed }).forEach(([key, value]) => localStorage.setItem(key, value))
  }, seed)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  return { context, page, errors }
}
const importFile = async (page, value) => {
  await page.getByRole("button", { name: "פעולות", exact: true }).click()
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("menuitem", { name: "שחזור", exact: true }).click()
  await (await chooser).setFiles({ name: "original.json", mimeType: "application/json", buffer: Buffer.from(value) })
}
try {
  await server.listen()
  browser = await ({ chromium, firefox, webkit })[engine].launch()
  for (const width of [1280, 390]) {
    const original = JSON.stringify(initial, null, 2)
    const { page, context, errors } = await open({ "Dib It": original }, width)
    await checkbox(page, "01").waitFor()
    assert.equal(await page.getByRole("textbox", { name: "סמסטר:" }).inputValue(), "תשפ״ו ב'", "workspace navigation wins over retired plan navigation")
    assert.equal(await raw(page), original, "read/normalization does not rewrite the original")
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey), null)
    await checkbox(page, "02").check()
    const changed = await stored(page)
    assert.equal(changed.schemaVersion, 1)
    assert.deepEqual(changed.plans[0].courses["2026b"][0].groups, ["01", "02"])
    assert.deepEqual(changed.plans[0].courses["2026a"][0].groups, ["01"], "ordinary semester edit does not use the retired semester")
    assert.equal(changed.plans[0].semester, "2026a")
    assert.deepEqual(changed.plans[0].tab, { obsolete: true })
    assert.deepEqual(changed.note, initial.note)
    assert.deepEqual(changed.plans[0].note, initial.plans[0].note)
    const preserved = await page.evaluate(key => localStorage.getItem(key), recoveryKey)
    assert.equal(JSON.parse(preserved).committed.storage["Dib It"], original)
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    const pending = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: "הורדת נתוני השחזור שנשמרו", exact: true }).click()
    const exportedRecovery = JSON.parse(await downloadText(pending))
    assert.equal(exportedRecovery.storage[recoveryKey], preserved, "the preserved original is available through the normal UI")
    await checkbox(page, "02").uncheck()
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey), preserved, "ordinary saves keep the migration original")
    await page.reload()
    await checkbox(page, "01").waitFor()
    assert.equal(await page.getByRole("textbox", { name: "סמסטר:" }).inputValue(), "תשפ״ו ב'")
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${engine} ${width}px: canonical navigation, real edits, retired/unknown metadata, exact original and reload`)
  }

  for (const data of [{ semester: "2026a", theme: "apple" }, { courses: { "2026a": [course] } }, { ...initial, tab: "practice" }]) {
    const original = JSON.stringify(data)
    const { page, context, errors } = await open({ "Dib It": original, "Hidden Tabs": '["practice"]' })
    await page.locator("#schedule-container").waitFor()
    assert.equal(await raw(page), original, "default semester, hidden tab and absent courses are read-only on opening")
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey), null)
    await page.getByRole("button", { name: "מבחנים", exact: true }).click()
    assert.equal((await stored(page)).schemaVersion, 1, "an explicit navigation action can commit the converted copy")
    assert.equal(JSON.parse(await page.evaluate(key => localStorage.getItem(key), recoveryKey)).committed.storage["Dib It"], original)
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log(`PASS ${engine}: opening empty, missing-navigation and hidden-tab legacy copies never rewrites them`)

  {
    const two = { ...initial, schemaVersion: 1, plans: [...initial.plans, { id: "second", name: "מערכת אחרת", courses: {} }] }
    const { page, context, errors } = await open({ "Dib It": JSON.stringify(two) })
    await checkbox(page, "01").waitFor()
    const other = await context.newPage()
    await other.goto(page.url())
    await other.locator("#schedule-container").waitFor()
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    await page.getByRole("menuitem", { name: "מערכות שעות", exact: true }).click()
    await page.getByRole("button", { name: "שכפול מערכת השעות", exact: true }).click()
    await page.getByRole("textbox", { name: "שם מערכת השעות", exact: true }).waitFor()
    await other.getByRole("button", { name: "פעולות", exact: true }).click()
    await other.getByRole("menuitem", { name: "מערכות שעות", exact: true }).click()
    await other.locator("#schedule-selector").click()
    await other.getByRole("option", { name: "מערכת אחרת", exact: true }).click()
    await page.getByRole("button", { name: "שמירה", exact: true }).click()
    const duplicated = (await stored(page)).plans.at(-1)
    assert.equal(duplicated.name, "מערכת מקורית — עותק")
    assert.deepEqual(duplicated.courses, two.plans[0].courses, "delayed duplicate copies its original source after another tab navigates")
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${engine}: delayed duplicate remains bound to its originating plan across real tabs`)
  }

  for (const failedKey of [recoveryKey, "Dib It"]) {
    const original = JSON.stringify(initial)
    const { page, context, errors } = await open({ "Dib It": original })
    await checkbox(page, "01").waitFor()
    await page.evaluate(failedKey => {
      const set = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === failedKey) throw new DOMException("migration quota test", "QuotaExceededError")
        return set.call(this, key, value)
      }
      window.restoreStorage = () => { Storage.prototype.setItem = set }
    }, failedKey)
    await checkbox(page, "02").click()
    await page.getByText("השינוי לא נשמר", { exact: true }).waitFor()
    assert.equal(await raw(page), original, "a preservation or primary failure cannot replace the saved copy")
    assert.equal(await checkbox(page, "02").isChecked(), false)
    const packageRaw = await page.evaluate(key => localStorage.getItem(key), recoveryKey)
    if (failedKey === recoveryKey) assert.equal(packageRaw, null)
    else assert.equal(JSON.parse(packageRaw).pending.package.storage["Dib It"], original, "interrupted commit leaves a recoverable original")
    await page.reload()
    await checkbox(page, "01").waitFor()
    assert.equal(await raw(page), original, "reload after interrupted migration retains old authority")
    await checkbox(page, "02").check()
    assert.equal((await stored(page)).schemaVersion, 1)
    assert.equal(JSON.parse(await page.evaluate(key => localStorage.getItem(key), recoveryKey)).committed.storage["Dib It"], original)
    assert.ok(errors.some(error => error.includes("migration quota test")))
    assert.deepEqual(errors.filter(error => !error.includes("migration quota test")), [])
    await context.close()
    console.log(`PASS ${engine}: ${failedKey} failure notice, no data loss, interruption, reload and retry`)
  }

  {
    const current = { ...initial, schemaVersion: 1 }
    const { page, context, errors } = await open({ "Dib It": JSON.stringify(current) })
    await checkbox(page, "01").waitFor()
    const incoming = `  ${JSON.stringify({ ...initial, plans: initial.plans.map(plan => ({ ...plan, name: "מיובאת" })) }, null, 2)}\n`
    await importFile(page, incoming)
    await page.getByRole("button", { name: "החלפת כל המערכות ושחזור", exact: true }).waitFor()
    await page.getByRole("button", { name: "ביטול", exact: true }).click()
    assert.equal((await stored(page)).plans[0].name, current.plans[0].name)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey), null, "canceled import writes no recovery or workspace")
    await importFile(page, incoming)
    await page.getByRole("button", { name: "החלפת כל המערכות ושחזור", exact: true }).click()
    await page.getByRole("dialog").waitFor({ state: "hidden" })
    assert.equal((await stored(page)).plans[0].name, "מיובאת")
    const recovered = JSON.parse(await page.evaluate(key => localStorage.getItem(key), recoveryKey)).committed
    assert.equal(recovered.incoming.raw, incoming, "file whitespace and original values survive conversion")
    assert.equal(recovered.storage["Dib It"], JSON.stringify(current))
    const before = await raw(page)
    await importFile(page, JSON.stringify({ ...initial, schemaVersion: 99 }))
    await page.getByText("השחזור נכשל", { exact: true }).waitFor()
    assert.equal(await page.getByRole("dialog").count(), 0)
    assert.equal(await raw(page), before, "future import cannot replace current data")
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${engine}: real file import cancel/confirm, exact incoming archive and future-version refusal`)
  }

  for (const data of [
    { ...initial, schemaVersion: 99 },
    { ...initial, customCourses: {}, plans: [...initial.plans, { id: "second", name: "אחרת", customCourses: { private: catalog } }] },
  ]) {
    const original = JSON.stringify(data, null, 2)
    const { page, context, errors } = await open({ "Dib It": original })
    await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).waitFor()
    assert.equal(await raw(page), original)
    const pending = page.waitForEvent("download")
    await page.getByRole("button", { name: "הורדת הנתונים לפני איפוס", exact: true }).click()
    assert.equal(await downloadText(pending), original, "unreadable/future sources remain downloadable byte for byte")
    page.once("dialog", dialog => dialog.dismiss())
    await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
    assert.equal(await raw(page), original)
    page.once("dialog", dialog => dialog.accept())
    await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
    await page.locator("#schedule-container").waitFor()
    assert.equal(await raw(page), null, "confirmed reset removes data; initial display does not recreate a saved workspace")
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey), null)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${engine}: unsupported/ambiguous input recovery download and explicit reset`)
  }
} finally {
  await browser?.close()
  await server.close()
}
