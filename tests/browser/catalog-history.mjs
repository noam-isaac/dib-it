import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium, firefox, webkit } from "playwright"
import { createServer } from "vite"

const history = JSON.parse(await readFile(new URL("../fixtures/catalog-history.json", import.meta.url)))
const manifest = JSON.parse(await readFile(new URL("../../src/assets/registration-template.json", import.meta.url)))
const semesters = Object.keys(history.catalogs)
const dates = Object.fromEntries(semesters.map(semester => [semester, {
  startDate: `${semester.slice(0, 4)}-01-04`, endDate: `${semester.slice(0, 4)}-01-10`,
}]))
const engine = process.env.DIBIT_BROWSER ?? "chromium"
const server = await createServer({ define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  cacheDir: `node_modules/.vite-test-catalog-history-${engine}`, server: { host: "127.0.0.1", port: 0 },
})
let browser
const slot = (bytes, key) => {
  const field = manifest.slots.find(slot => slot.key === key)
  return String.fromCharCode(...Array.from({ length: field.length }, (_, i) => bytes[field.offsets[i * 2]] | bytes[field.offsets[i * 2 + 1]] << 8)).replace(/[\u200b\u202a\u202c]/g, "")
}
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await ({ chromium, firefox, webkit })[engine].launch()
  for (const semester of semesters) {
    const page = await browser.newPage({ viewport: semester.endsWith("a") ? { width: 1280, height: 900 } : { width: 390, height: 844 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    page.on("console", message => { if (message.text().includes("same key")) errors.push(message.text()) })
    await page.route("**/*", route => new URL(route.request().url()).origin === url ? route.continue() : route.abort())
    await page.route("https://arazim-project.com/data/**", route => {
      const filename = new URL(route.request().url()).pathname.split("/").pop()
      return route.fulfill({ json: filename === "info.json" ? { currentSemester: semester, semesters: dates }
        : history.catalogs[filename.slice(8, -5)] ?? {} })
    })
    await page.addInitScript(semester => {
      // Exercise the polyfill as well as the native implementation.
      if (semester.endsWith("b")) Object.defineProperty(Map, "groupBy", { value: undefined, configurable: true, writable: true })
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify({ semester, tab: "schedule" }))
    }, semester)
    await page.goto(url)
    await page.getByPlaceholder("חיפוש קורסים להוספה").fill("צרפתית למתחילים")
    await page.getByRole("option", { name: "צרפתית למתחילים (21721600)", exact: true }).click()
    const card = page.locator("#course-21721600")
    await card.waitFor()
    assert.equal(await card.getByRole("checkbox").count(), 2)
    await card.getByRole("checkbox", { name: /^קבוצה 01/ }).check()
    await page.getByText("שעות: 4", { exact: true }).waitFor()
    assert.equal(await page.locator("#schedule-container").getByText("צרפתית למתחילים (שיעור ותרגיל)", { exact: true }).count(), 2)
    const other = semester.slice(0, 4) + (semester.endsWith("a") ? "b" : "a")
    await page.waitForFunction(other => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses[other]?.[0]?.groups?.includes("01"), other)
    const readCourses = () => page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses)
    assert.deepEqual(Object.keys(await readCourses()).sort(), [semester, other].sort())
    await page.locator("#semester-selector").click()
    await page.getByRole("option").nth(semesters.indexOf(other)).click()
    await page.getByText("שעות: 4", { exact: true }).waitFor()
    await page.reload()
    await page.getByText("שעות: 4", { exact: true }).waitFor()
    if (process.env.DIBIT_SCREENSHOT_DIR && semester.startsWith("2027")) await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/catalog-${engine}-${semester}.png`, fullPage: true })
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    const calendarDownload = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: "ייצוא ל-Apple/Google Calendar", exact: true }).click()
    const calendar = await readFile(await (await calendarDownload).path(), "utf8")
    assert.equal(calendar.match(/BEGIN:VEVENT/g)?.length, 2)
    assert.ok(calendar.includes(`UID:${other}-21721600-01-`))
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    await page.getByRole("menuitem", { name: "יצירת טופס רישום ב-Word", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("textbox", { name: /שם התלמיד/ }).fill("בדיקת קטלוג")
    await dialog.getByRole("textbox", { name: /מספר ת״ז/ }).fill("000000000")
    const wordDownload = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "הורדת הטופס המקורי (DOC)", exact: true }).click()
    const bytes = await readFile(await (await wordDownload).path())
    assert.deepEqual([...bytes.subarray(0, 8)], [208, 207, 17, 224, 161, 177, 26, 225])
    assert.equal(Array.from({ length: 8 }, (_, i) => slot(bytes, `rows.0.courseId.${i}`)).join(""), "21721600")
    assert.equal(slot(bytes, "rows.0.year.0") + slot(bytes, "rows.0.year.1"), String(Number(semester.slice(0, 4)) - 1).slice(-2))
    assert.equal(slot(bytes, "rows.0.semesterCode"), other.endsWith("a") ? "1" : "2")
    assert.equal(slot(bytes, "rows.1.name"), "")
    await page.keyboard.press("Escape")
    await card.getByRole("checkbox", { name: /^קבוצה 01/ }).uncheck()
    await page.getByText("שעות: 0", { exact: true }).waitFor()
    assert.deepEqual((await readCourses())[semester][0].groups, [])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${engine} ${semester}: selection, annual switch, reload, hours, timetable, ICS and DOC downloads, deselection`)
  }
} finally {
  await browser?.close()
  await server.close()
}
