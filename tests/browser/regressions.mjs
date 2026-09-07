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
const server = process.env.DIBIT_TEST_URL ? undefined : await createServer({
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
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("https://arazim-project.com/data/**", route => {
      const filename = new URL(route.request().url()).pathname.split("/").pop()
      const json = filename === "info.json" ? {
        currentSemester: "2026a",
        semesters: { "2026a": { startDate: "2025-10-26", endDate: "2026-01-25" } },
      } : filename.startsWith("courses-") ? catalog : {}
      return route.fulfill({ json })
    })
    await page.addInitScript(state => {
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify(state))
    }, initial)
    await page.goto(url)
    const day = page.getByRole("button", { name: "חיפוש מבחנים בתאריך 2026-02-23", exact: true })
    assert.equal(await day.innerText(), "23")
    assert.deepEqual(await page.locator("thead th").allTextContents(), ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"])
    await day.click()
    assert.equal(await page.getByLabel("תאריך / מתאריך").inputValue(), "2026-02-23")
    assert.equal(await page.locator(".exam-search-row").count(), 2)

    const actions = () => page.getByRole("button", { name: "פעולות", exact: true }).click()
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

    await actions()
    await page.getByRole("menuitem", { name: /יצירת טופס רישום/ }).click()
    await page.getByRole("textbox", { name: "שם התלמיד/ה" }).fill("A ".repeat(40))
    await page.getByRole("textbox", { name: "מספר ת״ז" }).fill("012345678")
    await page.getByRole("button", { name: /הורדת הטופס המקורי/ }).click()
    const notice = page.locator(".mantine-Notification-root").filter({ hasText: "יצירת הטופס נכשלה" }).last()
    await notice.waitFor()
    await notice.getByRole("button").click({ trial: true })
    assert.equal(await notice.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    }), true, "Export errors must appear above the modal overlay")
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes("012345678"))), false)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${timezoneId} ${viewport.width}px: date clicks, distinct exams, rejected restores, modal feedback`)
  }
} finally {
  await browser?.close()
  await server?.close()
}
