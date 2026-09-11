import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

// Synthetic state and intercepted catalogs: no account or live backup is used.
const courseId = "01022314"
const catalog = { [courseId]: {
  name: "קורס בדיקה", faculty: "פקולטה/חוג בדיקה",
  groups: [{ group: "01", lessons: [{ day: "א", time: "09:00-10:00", type: "שיעור" }] }],
  exams: [
    { date: "23/02/2026", moed: "א", type: "בחינת ביניים", hour: "09:00" },
    { date: "23/02/2026", moed: "א", type: "בחינה סופית", hour: "09:00" },
    { date: "24/02/2026", moed: "ב", type: "בחינה סופית", hour: "13:00" },
  ],
} }
const initial = {
  semester: "2026a", tab: "exams", activePlanId: "first",
  plans: [
    { id: "first", name: "בדיקה", courses: { "2026a": [{ id: courseId, groups: ["01"] }] } },
    { id: "second", name: "חלופה", courses: {} },
  ],
}
const server = process.env.DIBIT_TEST_URL ? undefined : await createServer({ cacheDir: "node_modules/.vite-test-regressions",
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  server: { host: "127.0.0.1", port: 0 },
})
let browser
try {
  await server?.listen()
  const url = process.env.DIBIT_TEST_URL ?? `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch()
  for (const [timezoneId, viewport] of [
    ["America/Los_Angeles", { width: 1280, height: 800 }],
    ["Asia/Jerusalem", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ timezoneId, viewport })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const actions = () => page.getByRole("button", { name: "פעולות", exact: true }).click()
    const openSchedules = async () => {
      await actions()
      await page.getByRole("menuitem", { name: "מערכות שעות", exact: true }).click()
    }
    const checkActivePlan = async name => {
      await openSchedules()
      assert.equal(await page.getByRole("textbox", { name: "מערכת שעות", exact: true }).inputValue(), name)
      await page.keyboard.press("Escape")
      await page.getByRole("dialog", { name: "מערכות שעות", exact: true }).waitFor({ state: "hidden" })
    }
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("https://arazim-project.com/data/**", route => {
      const filename = new URL(route.request().url()).pathname.split("/").pop()
      const json = filename === "info.json" ? {
        currentSemester: "2026a",
        semesters: { "2026a": { startDate: "2025-10-26", endDate: "2026-01-25" } },
      } : filename === "courses-2026a.json" ? catalog : {}
      return route.fulfill({ json })
    })
    await page.addInitScript(state => {
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify(state))
    }, initial)
    await page.goto(url)
    const intro = page.getByRole("dialog", { name: "מה נוסף ביחס ל־Dib It המקורי?", exact: true })
    await intro.waitFor()
    if (process.env.DIBIT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/intro-${viewport.width}.png`, animations: "disabled" })
    await intro.getByRole("button", { name: "למערכת השעות", exact: true }).click()
    await intro.waitFor({ state: "hidden" })
    await page.reload()
    await checkActivePlan("בדיקה")
    assert.equal(await page.locator(`#course-${courseId}`).evaluate(element => getComputedStyle(element).color), "rgb(255, 255, 255)", "Scheduled courses retain their original text color")
    assert.equal(await page.getByRole("button", { name: /^החלפת מערכת שעות:/ }).count(), 0, "Schedule switching must stay in the actions menu")
    assert.equal(await page.locator("#sidebar").getByRole("button", { name: "בדיקה", exact: true }).count(), 0, "The active schedule must not add a row above the semester selector")
    assert.equal(await intro.count(), 0, "The introduction must not reopen on a repeat visit")
    assert.equal(await page.title(), "דיביט של נועם")
    await page.locator("#header").getByText("דיביט של נועם", { exact: true }).waitFor()
    assert.equal(await page.locator('#header a[aria-label="קוד המקור של דיביט של נועם בגיטהאב"]').getAttribute("href"), "https://github.com/noam-isaac/dib-it")
    assert.equal(await page.locator('a[href="/contact-us"], a[href="/disclaimer"]').count(), 0)
    const introButton = page.locator("footer p").getByRole("button", { name: "מה חדש בגרסה הזו?", exact: true })
    const layout = await page.locator("#main").boundingBox()
    await introButton.click()
    await intro.waitFor()
    await page.keyboard.press("Escape")
    await intro.waitFor({ state: "hidden" })
    assert.deepEqual(await page.locator("#main").boundingBox(), layout, "Opening the introduction must not shift the main layout")
    await openSchedules()
    await page.getByRole("textbox", { name: "מערכת שעות", exact: true }).click()
    await page.getByRole("option", { name: "חלופה", exact: true }).click()
    await openSchedules()
    await page.getByRole("textbox", { name: "מערכת שעות", exact: true }).click()
    await page.getByRole("option", { name: "בדיקה", exact: true }).click()
    const day = page.getByRole("button", { name: "חיפוש מבחנים בתאריך 2026-02-23", exact: true })
    assert.equal(await day.innerText(), "23")
    assert.deepEqual(await page.locator("thead th").allTextContents(), ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"])
    await day.click()
    assert.equal(await page.getByLabel("תאריך / מתאריך").inputValue(), "2026-02-23")
    assert.equal(await page.locator(".exam-search-row").count(), 2)

    await actions()
    const calendarDownload = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: /ייצוא ל-Apple\/Google Calendar/ }).click()
    const calendar = await (await calendarDownload).createReadStream()
    const chunks = []
    for await (const chunk of calendar) chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).toString().match(/BEGIN:VEVENT/g).length, 17) // 14 Sundays + 3 exams

    const before = await page.evaluate(() => localStorage.getItem("Dib It"))
    for (const invalid of [
      { unrelated: true },
      { ...initial, practicedExams: { [courseId]: {} } },
      { ...initial, customCourses: { "bad.json": { [courseId]: { groups: 2 } } } },
    ]) {
      await actions()
      const chooser = page.waitForEvent("filechooser")
      await page.getByRole("menuitem").filter({ hasText: /^שחזור$/ }).click()
      await (await chooser).setFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) })
      await page.getByText("הקובץ אינו גיבוי תקין של Dib It.", { exact: true }).first().waitFor()
      assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before)
      const notice = page.locator(".mantine-Notification-root").filter({ hasText: "השחזור נכשל" })
      await notice.getByRole("button").click()
      await notice.waitFor({ state: "detached" })
    }
    await page.reload()
    await page.waitForSelector(`#course-${courseId}`)
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans.length), 2)

    await page.evaluate(() => {
      const workspace = JSON.parse(localStorage.getItem("Dib It"))
      const plan = workspace.plans.find(plan => plan.id === workspace.activePlanId)
      plan.courses["2026a"].push({ id: "L1", groups: ["01"] }, { id: "L2", groups: ["01"] })
      localStorage.setItem("Dib It", JSON.stringify(workspace))
    })
    await page.reload()
    await page.waitForSelector(`#course-${courseId}`)
    await actions()
    await page.getByRole("menuitem", { name: /יצירת טופס רישום/ }).click()
    await page.getByRole("dialog").getByText("מערכת שעות: בדיקה", { exact: true }).waitFor()
    assert.equal(await page.getByRole("dialog").locator("tbody tr").count(), 1)
    assert.equal(await page.getByRole("dialog").getByText(/^L[12]$/).count(), 0)
    await page.getByRole("textbox", { name: "שם התלמיד/ה" }).fill("A ".repeat(40))
    await page.getByRole("textbox", { name: "מספר ת״ז" }).fill("012345678")
    await page.getByRole("button", { name: /הורדת הטופס המקורי/ }).click()
    const notice = page.locator(".mantine-Notification-root").filter({ hasText: "יצירת הטופס נכשלה" }).last()
    await notice.waitFor()
    await notice.getByRole("button").click({ trial: true })
    const hit = await notice.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
      const top = document.elementFromPoint(x, y)
      return { covered: element.contains(top), x, y, viewport: [innerWidth, innerHeight],
        rect: [rect.x, rect.y, rect.width, rect.height].map(Math.round),
        top: top ? `${top.tagName}.${top.className}` : null }
    })
    assert.equal(hit.covered, true, `Export errors must appear above the modal overlay: ${JSON.stringify(hit)}`)
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes("012345678"))), false)
    await notice.getByRole("button").click()
    await page.getByRole("textbox", { name: "שם התלמיד/ה" }).fill("ישראל ישראלי")
    const wordDownload = page.waitForEvent("download")
    await page.getByRole("button", { name: /הורדת הטופס המקורי/ }).click()
    const word = await wordDownload
    assert.equal(word.suggestedFilename(), "dibit-registration-2025-1.doc")
    const wordChunks = []
    for await (const chunk of await word.createReadStream()) wordChunks.push(chunk)
    assert.deepEqual([...Buffer.concat(wordChunks).subarray(0, 8)], [208, 207, 17, 224, 161, 177, 26, 225])
    await page.keyboard.press("Escape")
    await page.evaluate(raw => localStorage.setItem("Dib It", raw), before)
    await page.reload()
    await page.waitForSelector(`#course-${courseId}`)

    const restore = async state => {
      await actions()
      const chooser = page.waitForEvent("filechooser")
      await page.getByRole("menuitem").filter({ hasText: /^שחזור$/ }).click()
      await (await chooser).setFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(state)) })
      await page.getByRole("dialog", { name: "שחזור מקובץ" }).waitFor()
      await page.getByRole("dialog", { name: "שחזור מקובץ" }).getByRole("button", { name: "ביטול", exact: true }).click({ trial: true })
    }
    const incoming = {
      ...initial,
      plans: [{ ...initial.plans[0], name: "משוחזרת" }, initial.plans[1]],
      customCourses: { "custom.json": { [courseId]: { ...catalog[courseId], name: "קורס מהגיבוי" } } },
    }
    await restore(incoming)
    const dialog = page.getByRole("dialog", { name: "שחזור מקובץ" })
    await dialog.getByText("משוחזרת — תיפתח לאחר השחזור", { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before)
    await dialog.getByRole("button", { name: "ביטול", exact: true }).click()
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before)
    await restore(incoming)
    const recoveryDownload = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "הורדת גיבוי של המערכות הנוכחיות", exact: true }).click()
    const recovery = await recoveryDownload
    assert.equal(recovery.suggestedFilename(), "dibit-before-restore.json")
    const savedChunks = []
    for await (const chunk of await recovery.createReadStream()) savedChunks.push(chunk)
    const savedWorkspace = JSON.parse(Buffer.concat(savedChunks).toString())
    assert.deepEqual(savedWorkspace, JSON.parse(before))
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem
      window.restoreStorageWrites = () => { Storage.prototype.setItem = setItem }
      Storage.prototype.setItem = function (key, value) {
        if (key === "Dib It") throw new DOMException("Storage full", "QuotaExceededError")
        return setItem.call(this, key, value)
      }
    })
    await dialog.getByRole("button", { name: "החלפת כל המערכות ושחזור", exact: true }).click()
    await dialog.getByText("לא ניתן לשמור את השחזור בדפדפן. המערכות הנוכחיות נשארו כפי שהן.", { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before)
    await page.evaluate(() => window.restoreStorageWrites())
    await dialog.getByRole("button", { name: "החלפת כל המערכות ושחזור", exact: true }).click()
    await page.getByText("השחזור הושלם", { exact: true }).waitFor()
    await checkActivePlan("משוחזרת")
    await page.locator(`#course-${courseId}`).getByText(`קורס מהגיבוי (${courseId})`, { exact: true }).waitFor()
    await dialog.waitFor({ state: "hidden" })
    await page.getByRole("button", { name: "פעולות", exact: true }).scrollIntoViewIfNeeded()
    if (process.env.DIBIT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/schedule-${viewport.width}.png`, animations: "disabled" })
    await restore(savedWorkspace)
    if (process.env.DIBIT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/restore-${viewport.width}.png`, animations: "disabled" })
    await dialog.getByRole("button", { name: "החלפת כל המערכות ושחזור", exact: true }).click()
    await checkActivePlan("בדיקה")
    await page.locator(`#course-${courseId}`).getByText(`קורס בדיקה (${courseId})`, { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It"))), savedWorkspace)
    await page.reload()
    await checkActivePlan("בדיקה")
    if (server) {
      // Exercise Google confirmation locally without an account or remote writes.
      await page.evaluate(async incoming => {
        const { openScheduleRestore } = await import("/src/components/RestoreScheduleModal.tsx")
        openScheduleRestore({ ...incoming, semester: "2025b", tab: "schedule" }, "google")
      }, incoming)
      const googleDialog = page.getByRole("dialog", { name: "שחזור מגוגל", exact: true })
      await googleDialog.waitFor()
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It"))), savedWorkspace)
      await googleDialog.getByRole("button", { name: "החלפת כל המערכות ושחזור", exact: true }).click()
      await checkActivePlan("משוחזרת")
      const googleResult = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")))
      assert.equal(googleResult.semester, initial.semester)
      assert.equal(googleResult.tab, initial.tab)
    }
    await restore({ courses: initial.plans[0].courses })
    await dialog.getByRole("button", { name: "החלפת כל המערכות ושחזור", exact: true }).click()
    await checkActivePlan("מערכת השעות שלי")
    const legacyResult = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")))
    assert.equal(legacyResult.semester, initial.semester)
    assert.equal(legacyResult.plans.length, 1)
    assert.deepEqual(legacyResult.plans[0].courses, initial.plans[0].courses)
    for (const semester of ["2026a", "2026b"]) {
      await page.evaluate(semester => localStorage.setItem("Dib It", JSON.stringify({
        semester, tab: "schedule", courses: {},
      })), semester)
      await page.reload()
      for (const [id, name] of [["L1", "סמינר לאוטמן"], ["L2", "מחקר מודרך לאוטמן"]]) {
        await page.getByPlaceholder("חיפוש קורסים להוספה").fill(name)
        await page.getByRole("option", { name: `${name} (${id})`, exact: true }).click()
        await page.locator(`#course-${id}`).getByRole("checkbox").check()
        await page.locator("#schedule-container").getByText(`${name} (שנתי)`, { exact: true }).waitFor()
      }
      await page.getByText("שעות: 4", { exact: true }).waitFor()
      assert.match(await page.locator("#schedule-container").innerText(), /14:00/)
      assert.match(await page.locator("#schedule-container").innerText(), /18:00/)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${timezoneId} ${viewport.width}px: exams, schedule context, restore preview/cancel/recovery, immediate catalog refresh, modal feedback`)
  }
} finally {
  await browser?.close()
  await server?.close()
}
