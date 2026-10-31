import { prepareAnnualFeed } from "./annual-fixture.mjs"
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ cacheDir: "node_modules/.vite-test-dx-regressions",
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  server: { host: "127.0.0.1", port: 0 },
})
const info = { currentSemester: "2026a", semesters: Object.fromEntries(
  ["2024a", "2025a", "2026a", "2026b"].map(semester => [semester, {}]),
) }
const catalog = { "12345678": { name: "ללא מידע על מבחן", groups: [{ group: "01", lessons: [] }, { group: "02", lessons: [{ day: "א", time: "10:00-11:30", type: "שיעור" }] }] }, "87654321": { name: "קורס נוסף ללא מבחן", groups: [] } }
const plans = faculty => ({ [faculty]: { "תוכנית בדיקה": { "קורסי חובה": { courses: { "12345678": { id: "12345678", weight: "1" }, "87654321": { id: "87654321", weight: "1" } }, count: 1 } } } })
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  for (const failedResource of ["info.json", "courses-2026a.json"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    let failed = true, failedPlan = true, delayed
    const requests = []
    page.on("request", request => requests.push(request.url()))
    await page.route("**/*", route => {
      const url = new URL(route.request().url())
      if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
      if (url.hostname !== "127.0.0.1" || !url.pathname.startsWith("/data/")) return route.abort()
      const filename = url.pathname.split("/").pop()
      if (failed && filename === failedResource) return route.fulfill({ status: 503, body: "Unavailable" })
      if (failedPlan && filename === "plans-2026.json") return route.fulfill({ status: 503, body: "Unavailable" })
      if (filename === "plans-2024.json") { delayed = route; return }
      const json = filename === "info.json" ? info
        : filename.startsWith("courses-") ? catalog
        : filename.startsWith("plans-") ? { ...plans(filename === "plans-2025.json" ? "פקולטה חדשה" : "פקולטה לבדיקה"), ...plans("פקולטה אחרת") } : {}
      return route.fulfill({ json })
    })
    await page.addInitScript(() => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify({
        degreeStartYear: "2026", school: "פקולטה לבדיקה", studyPlan: "תוכנית בדיקה",
        courses: { "2026a": [{ id: "12345678", groups: ["01"] }] },
      }))
    })
    await prepareAnnualFeed(page)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.getByRole("alert").filter({ hasText: "לא ניתן לטעון" }).waitFor()
    // Backup remains reachable even if the current catalog failed.
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    await page.getByRole("menuitem", { name: /גיבוי/ }).first().waitFor()
    await page.keyboard.press("Escape")
    failed = false
    await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click()
    await page.locator("#schedule-container").waitFor()
    assert.equal(await page.getByRole("textbox", { name: "סמסטר:" }).inputValue() !== "", true)
    await page.getByPlaceholder("חיפוש קורסים להוספה", { exact: true }).fill("ללא מידע על מבחן (12345678)")
    assert.equal(await page.locator("#course-12345678").count(), 1, "pasting an existing course must not duplicate it")
    await page.keyboard.press("Escape")
    const card = page.locator("#course-12345678")
    await card.getByText("ללא שעות במערכת", { exact: true }).waitFor()
    assert.equal(await card.evaluate(el => getComputedStyle(el).borderTopStyle), "dashed")
    await card.getByRole("checkbox", { name: "קבוצה 02", exact: true }).check()
    assert.equal(await card.getByText("ללא שעות במערכת", { exact: true }).count(), 0)
    assert.equal(await card.evaluate(el => getComputedStyle(el).borderTopStyle), "solid")
    await card.getByRole("checkbox", { name: "קבוצה 02", exact: true }).uncheck()
    await card.getByText("ללא שעות במערכת", { exact: true }).waitFor()
    // A workspace update must refresh other subscribers before the next edit.
    await page.evaluate(async () => {
      const { getDibIt, setDibIt } = await import("/src/models.ts")
      setDibIt({ ...getDibIt(), theme: "apple" })
    })
    await page.getByRole("button", { name: "תוכנית", exact: true }).click()
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).theme), "apple")
    await page.getByRole("alert").filter({ hasText: "לא ניתן לטעון את נתוני תוכניות" }).waitFor()
    failedPlan = false
    await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click()
    await page.locator(".mantine-Switch-root").filter({ hasText: "הצג רק קורסים שעוברים בסמסטר הנבחר ומיין לפי השתלבות בתקופת מבחנים" }).click()
    await page.getByRole("heading", { name: "קורסי חובה", exact: true }).waitFor()
    const year = page.getByRole("textbox", { name: "שנת התחלת התואר", exact: true })
    await year.click()
    const requested = page.waitForRequest(request => request.url().includes("plans-2024.json"))
    await page.getByRole("option", { name: "2024", exact: true }).click()
    await requested
    assert.ok(delayed)
    await year.click()
    await page.getByRole("option", { name: "2025", exact: true }).click()
    const program = page.getByRole("textbox", { name: "תוכנית לימוד", exact: true })
    await program.fill("תוכנית")
    await page.getByRole("option", { name: "תוכנית בדיקה — פקולטה חדשה", exact: true }).waitFor()
    await delayed.fulfill({ json: plans("פקולטה ישנה") })
    await page.waitForTimeout(150)
    assert.equal(await page.getByRole("option", { name: /פקולטה ישנה/ }).count(), 0)
    await page.getByRole("option", { name: "תוכנית בדיקה — פקולטה חדשה", exact: true }).click()
    await page.getByRole("button", { name: "שמירה למעבר מהיר", exact: true }).click()
    await program.fill("אחרת")
    await page.getByRole("option", { name: "תוכנית בדיקה — פקולטה אחרת", exact: true }).click()
    await page.getByRole("button", { name: "שמירה למעבר מהיר", exact: true }).click()
    const readView = () => page.evaluate(async () => (await import("/src/models.ts")).getDibIt())
    assert.equal((await readView()).school, "פקולטה אחרת", "duplicate program names retain faculty identity")
    const coursesBefore = (await readView()).courses
    await page.getByRole("textbox", { name: "מעבר מהיר בין תוכניות", exact: true }).click()
    await page.getByRole("option", { name: "תוכנית בדיקה — פקולטה חדשה", exact: true }).click()
    await page.getByRole("button", { name: "הסרה מהמעבר המהיר", exact: true }).click()
    assert.deepEqual((await readView()).savedStudyPlans, [{ school: "פקולטה אחרת", studyPlan: "תוכנית בדיקה" }])
    assert.equal((await readView()).school, "פקולטה חדשה")
    assert.deepEqual((await readView()).courses, coursesBefore, "removing a shortcut preserves courses and active program")
    await page.reload()
    await page.getByRole("textbox", { name: "מעבר מהיר בין תוכניות", exact: true }).click()
    assert.equal(await page.getByRole("option", { name: /פקולטה חדשה/ }).count(), 0)
    await page.getByRole("option", { name: "תוכנית בדיקה — פקולטה אחרת", exact: true }).click()
    await page.getByRole("button", { name: "הסרה מהמעבר המהיר", exact: true }).click()
    assert.equal(await page.getByRole("textbox", { name: "מעבר מהיר בין תוכניות", exact: true }).count(), 0)
    await page.getByRole("button", { name: "הגדרות", exact: true }).click()
    const beforeImport = await page.evaluate(() => localStorage.getItem("Dib It"))
    await page.locator('#content input[type="file"]').setInputFiles({
      name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"bad":{"groups":2}}'),
    })
    await page.getByText("ייבוא הקורסים נכשל", { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), beforeImport)
    await page.locator('#content input[type="file"]').setInputFiles({
      name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(catalog)),
    })
    await page.getByRole("button", { name: /valid.json/ }).waitFor()
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).customCourses["valid.json"]), catalog)
    // Optional preferences heal without replacing any workspace data.
    const preserved = await page.evaluate(() => localStorage.getItem("Dib It"))
    await page.evaluate(() => {
      localStorage.setItem("Compact View", "broken-json")
      localStorage.setItem("Sidebar Compact", "broken-json")
      localStorage.setItem("unrelated-setting", "keep")
    })
    await page.reload()
    await page.getByRole("button", { name: "מערכת", exact: true }).click()
    await page.locator("#schedule-container").waitFor()
    assert.equal(await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).count(), 0)
    const healed = await page.evaluate(() => [localStorage.getItem("Compact View"), localStorage.getItem("Sidebar Compact")])
    assert.equal(healed.includes("broken-json"), false)
    for (const invalid of ["broken-json", "[]", "null", '\"wrong-type\"']) {
      await page.evaluate(invalid => {
        localStorage.setItem("Sidebar Compact", invalid)
        window.dispatchEvent(new StorageEvent("storage", { key: "Sidebar Compact", newValue: invalid }))
      }, invalid)
      assert.equal(await page.evaluate(() => localStorage.getItem("Sidebar Compact")), null)
    }
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It"))), { ...JSON.parse(preserved), tab: "schedule" })
    assert.equal(await page.evaluate(() => localStorage.getItem("unrelated-setting")), "keep")
    // Crash recovery downloads raw workspace data and cancellation never wipes it.
    const before = await page.evaluate(() => {
      const raw = JSON.stringify({ plans: [], activePlanId: "bad" })
      localStorage.setItem("Dib It", raw)
      localStorage.setItem("unrelated-setting", "keep")
      return raw
    })
    await page.reload()
    await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "recovery screen fits a phone")
    assert.equal((await page.locator("body").innerText()).includes("unrelated-setting"), false, "recovery screen must not dump browser storage")
    if (process.env.DIBIT_RECOVERY_SCREENSHOT) await page.screenshot({ path: process.env.DIBIT_RECOVERY_SCREENSHOT, fullPage: true })
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "הורדת הנתונים לפני איפוס", exact: true }).click()
    const chunks = []
    for await (const chunk of await (await download).createReadStream()) chunks.push(chunk)
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
      format: "dibit-storage-recovery", version: 1,
      storage: { "Dib It": before, "Dib It Migration Recovery": await page.evaluate(() => localStorage.getItem("Dib It Migration Recovery")) },
    }, "recovery includes both the malformed current bytes and the preserved migration original")
    // Recovery offers a way out that does not cost the user their schedules.
    await page.getByRole("button", { name: "איפוס העדפות התצוגה", exact: true }).click()
    await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before,
      "resetting preferences must never delete schedules")
    assert.equal(await page.evaluate(() => localStorage.getItem("unrelated-setting")), "keep")
    page.once("dialog", dialog => dialog.dismiss())
    await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before)
    page.once("dialog", dialog => dialog.accept())
    await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
    await page.locator("#schedule-container").waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("unrelated-setting")), "keep")
    await page.getByRole("button", { name: "תוכנית", exact: true }).click()
    await year.click()
    await page.getByRole("option", { name: "2026", exact: true }).click()
    assert.equal(await program.isDisabled(), true)
    assert.equal(requests.some(url => url.includes("plans-undefined") || url.includes("plans-.json")), false)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${failedResource}: retry, backup access, shared state, missing exams, year race, recovery`)
  }
  // Storage denial must not make the recovery screen fail while enumerating old keys.
  for (const denied of ["storage", "enumeration"]) {
    const page = await browser.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.addInitScript(denied => {
      if (denied === "storage") Object.defineProperty(window, "localStorage", {
        get() { throw new DOMException("Storage denied", "SecurityError") },
      })
      else Object.defineProperty(Storage.prototype, "length", {
        get() { throw new DOMException("Enumeration denied", "SecurityError") },
      })
    }, denied)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).waitFor()
    assert.equal(await page.getByRole("button", { name: "טעינה מחדש", exact: true }).isEnabled(), true)
    if (denied === "enumeration") {
      assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), null)
      assert.equal(await page.evaluate(async () => {
        try { (await import("/src/preferences.ts")).legacyWorkspaceKeys(); return false }
        catch { return true }
      }), true, "migration, backup and reset must not treat failed enumeration as empty storage")
    }
    await page.getByRole("button", { name: "הורדת הנתונים לפני איפוס", exact: true }).click()
    await page.getByRole("alert").filter({ hasText: "לא ניתן להוריד את נתוני השחזור" }).waitFor()
    page.once("dialog", dialog => dialog.accept())
    await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
    await page.getByRole("alert").filter({ hasText: "איפוס המערכות לא הושלם" }).waitFor()
    if (denied === "storage") {
      await page.getByRole("button", { name: "איפוס העדפות התצוגה", exact: true }).click()
      await page.getByRole("alert").filter({ hasText: "איפוס העדפות התצוגה לא הושלם" }).waitFor()
    }
    assert.deepEqual(errors, [], "failed recovery actions must explain the failure without uncaught storage errors")
    await page.close()
    console.log(`PASS denied ${denied}: recovery remains visible`)
  }
  // A failed reset must stop before primary deletion and report any partial cleanup honestly.
  for (const failedKey of ["Automatic Google Sync", "Dib It Updated", "Dib It"]) {
    const page = await browser.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    const raw = '{"plans":[],"activePlanId":"invalid","note":"preserve these bytes"}'
    await page.addInitScript(raw => {
      if (sessionStorage.getItem("reset-seeded")) return
      sessionStorage.setItem("reset-seeded", "true")
      Object.entries({ "Dib It": raw, "Dib It Sync": "receipt", "Dib It Updated": "time",
        "Dib It Migration Recovery": "original recovery", "Automatic Google Sync": "true",
        "Dib It Fork Intro Seen": "true" }).forEach(([key, value]) => localStorage.setItem(key, value))
    }, raw)
    await page.route("**/*", route => {
      const url = new URL(route.request().url())
      if (url.hostname !== "127.0.0.1") return route.abort()
      if (!url.pathname.startsWith("/data/")) return route.continue()
      return route.fulfill({ json: url.pathname.endsWith("info.json") ? info : url.pathname.includes("courses-") ? catalog : {} })
    })
    await prepareAnnualFeed(page)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).waitFor()
    await page.evaluate(failedKey => {
      const remove = Storage.prototype.removeItem
      window.removalAttempts = []
      Storage.prototype.removeItem = function (key) {
        window.removalAttempts = [...window.removalAttempts, key]
        if (key === failedKey) throw new DOMException("Reset removal denied", "SecurityError")
        return remove.call(this, key)
      }
      window.restoreRemoval = () => { Storage.prototype.removeItem = remove }
    }, failedKey)
    page.once("dialog", dialog => {
      assert.match(dialog.message(), /הסנכרון האוטומטי יכובה/)
      void dialog.accept()
    })
    await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
    await page.getByRole("alert").filter({ hasText: "ייתכן שחלק מהנתונים כבר נמחקו" }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), raw, "primary remains readable after incomplete reset")
    const attempts = await page.evaluate(() => window.removalAttempts)
    assert.equal(attempts[0], "Automatic Google Sync", "sync is disabled before deleting workspace data")
    assert.equal(await page.evaluate(() => localStorage.getItem("Automatic Google Sync")), failedKey === "Automatic Google Sync" ? "true" : null)
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It Sync")), failedKey === "Automatic Google Sync" ? "receipt" : null)
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "הורדת הנתונים לפני איפוס", exact: true }).click()
    const chunks = []
    for await (const chunk of await (await download).createReadStream()) chunks.push(chunk)
    const recovered = Buffer.concat(chunks).toString()
    assert.equal(failedKey === "Dib It" ? recovered : JSON.parse(recovered).storage["Dib It"], raw)
    assert.equal(await page.getByRole("alert").count(), 0, "successful download clears the previous action failure")
    await page.evaluate(() => window.restoreRemoval())
    page.once("dialog", dialog => dialog.accept())
    await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
    await page.locator("#schedule-container").waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("Automatic Google Sync")), null)
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), null)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS reset failure at ${failedKey}: visible failure, sync first, primary last, recovery download and retry`)
  }
  // Legacy recovery must survive reloads; never re-seed the failed data after reset.
  for (const mode of ["valid", "legacy", "mixed"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10000)
    const malformed = mode !== "valid"
    const legacy = malformed ? {
      "Courses 2026a": '["12345678"]', "Groups 2026a": '{broken\n',
      "Colors 2026a": '{"12345678":"#001122"}',
      "School (Dib It Serialize)": '"פקולטה"',
    } : {
      Semester: '"2026a"', Courses: '["12345678"]', Groups: '{"12345678":["02"]}',
      Colors: '{"12345678":"#001122"}',
    }
    const unrelated = { "unrelated-setting": "keep", "Courses wishlist": "keep", "Groups notes": "keep" }
    await page.route("**/*", route => {
      const url = new URL(route.request().url())
      if (url.hostname !== "127.0.0.1") return route.abort()
      if (!url.pathname.startsWith("/data/")) return route.continue()
      return route.fulfill({ json: url.pathname.endsWith("info.json") ? info
        : url.pathname.includes("courses-") ? catalog : {} })
    })
    const modern = mode === "mixed" ? { "Dib It": '{"plans":[],"activePlanId":"invalid"}' } : {}
    const original = { ...modern, ...legacy }
    await page.addInitScript(({ legacy, unrelated, modern }) => {
      if (sessionStorage.getItem("legacy-seeded")) return
      sessionStorage.setItem("legacy-seeded", "true")
      Object.entries({ ...legacy, ...modern, ...unrelated, "Dib It Fork Intro Seen": "true" })
        .forEach(([key, value]) => localStorage.setItem(key, value))
    }, { legacy, unrelated, modern })
    await prepareAnnualFeed(page)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    if (malformed) {
      const failure = page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true })
      await failure.waitFor()
      const pending = page.waitForEvent("download")
      await page.getByRole("button", { name: "הורדת הנתונים לפני איפוס", exact: true }).click()
      const chunks = []
      for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk)
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
        format: "dibit-storage-recovery", version: 1, storage: original,
      }, "legacy recovery preserves every original string, including invalid JSON")
      await page.getByRole("button", { name: "איפוס העדפות התצוגה", exact: true }).click()
      await failure.waitFor()
      assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(original)), original)
      page.once("dialog", dialog => dialog.dismiss())
      await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
      assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(original)), original, "cancellation keeps both storage formats")
      page.once("dialog", dialog => dialog.accept())
      await page.getByRole("button", { name: "איפוס המערכות במכשיר", exact: true }).click()
    }
    await page.locator("#schedule-container").waitFor()
    assert.equal(await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).count(), 0)
    if (!malformed) {
      assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), null, "reading legacy data alone does not rewrite it")
      assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(legacy)), legacy)
      await page.locator("#course-12345678").getByRole("checkbox", { name: "קבוצה 01", exact: true }).check()
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It Migration Recovery")).committed.storage), legacy,
        "the first actual edit preserves the original legacy strings before conversion")
    }
    assert.deepEqual(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), Object.keys(legacy)), Object.keys(legacy).map(() => null))
    assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(unrelated)), unrelated)
    if (!malformed) assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses["2026a"]), [
      { id: "12345678", groups: ["02", "01"], color: "#001122" },
    ], "valid legacy migration retains the existing selection and colour while applying the new edit")
    await page.close()
    console.log(`PASS ${mode} storage: ${malformed ? "raw recovery, preference reset, cancellation and confirmed reset" : "migration"}; unrelated storage retained`)
  }
} finally {
  await browser?.close()
  await server.close()
}
