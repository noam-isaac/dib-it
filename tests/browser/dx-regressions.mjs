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
      if (url.hostname === "127.0.0.1") return route.continue()
      if (url.hostname !== "arazim-project.com") return route.abort()
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
    // R01: one unreadable display preference must not take the whole app down, and must
    // not cost the user a schedule. It heals itself at the read boundary.
    await page.evaluate(() => {
      localStorage.setItem("Compact View", "broken-json")
      localStorage.setItem("unrelated-setting", "keep")
    })
    await page.reload()
    await page.locator("#content").waitFor()
    assert.equal(await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).count(), 0,
      "a corrupt preference must never reach the recovery screen")
    const healed = await page.evaluate(() => ({
      compact: localStorage.getItem("Compact View"),
      workspace: localStorage.getItem("Dib It"),
      unrelated: localStorage.getItem("unrelated-setting"),
    }))
    assert.notEqual(healed.compact, "broken-json", "a corrupt preference must reset itself")
    assert.equal(healed.workspace?.includes("12345678"), true, "healing a preference must keep schedules")
    assert.equal(healed.unrelated, "keep", "healing must not touch unrelated origin storage")

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
    assert.equal(Buffer.concat(chunks).toString(), before)
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
} finally {
  await browser?.close()
  await server.close()
}
