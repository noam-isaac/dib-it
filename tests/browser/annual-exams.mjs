import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { createServer } from "vite"

const catalogs = JSON.parse(await readFile(new URL("../fixtures/french-catalogs-2027.json", import.meta.url)))
const annual = {
  source: "https://www.ims.tau.ac.il/Tal/KR/Search_P.aspx", filter: "ckSem=0", verifiedAt: "2099-01-01",
  groups: { "21721600": ["01", "02"] },
  exams: { "21721600": { verifiedAt: "2099-01-02T00:00:00Z", groups: Object.fromEntries(["01", "02"].map(group => [group, [
    { date: "27/06/2027", moed: "א", hour: "09:00", type: "בחינה סופית" },
    { date: "22/07/2027", moed: "ב", hour: "09:00", type: "בחינה סופית" },
  ]])) } },
}
const server = await createServer({ define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  cacheDir: "node_modules/.vite-test-annual-exams", server: { host: "127.0.0.1", port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    let release, failFeed = false, currentAnnual = annual
    const delayed = new Promise(resolve => { release = resolve })
    await page.route("**/*", async route => {
      const url = new URL(route.request().url())
      if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
      if (url.pathname === "/data/annual-groups.json") {
        await delayed
        return failFeed ? route.abort() : route.fulfill({ json: { version: 1, years: { "2027": currentAnnual } } })
      }
      if (url.hostname !== "127.0.0.1" || !url.pathname.startsWith("/data/")) return route.abort()
      const filename = url.pathname.split("/").pop()
      return route.fulfill({ json: filename === "info.json" ? {
        currentSemester: "2027a", semesters: Object.fromEntries(["2027a", "2027b"].map(semester => [
          semester, { startDate: "2026-10-18", endDate: "2026-10-24" },
        ])),
      } : filename === "courses.json" ? { "21721600": { name: "צרפתית למתחילים", semesters: ["2027a", "2027b"] } }
        : filename === "plans-2027.json" ? { "בדיקה": { "בדיקה": { "קורסים": { count: 1, courses: { "21721600": { id: "21721600", weight: 1 } } } } } }
        : catalogs[filename.slice(8, -5)] ?? {} })
    })
    await page.addInitScript(annual => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      if (!localStorage.getItem("Dib It")) {
        localStorage.setItem("Annual Course Registry", JSON.stringify({ version: 1, years: { "2027": { ...annual, exams: { "21721600": { verifiedAt: "2099-01-01T00:00:00Z", groups: { "01": [], "02": [] } } } } } }))
        localStorage.setItem("Dib It", JSON.stringify({ semester: "2027b", tab: "exams", degreeStartYear: "2027", school: "בדיקה", studyPlan: "בדיקה", courses: {
          "2027b": [{ id: "21721600", groups: ["01", "02"] }],
        } }))
      }
    }, annual)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.getByText("אין מבחנים להצגה.", { exact: false }).waitFor()
    release()
    const examRows = page.locator("#content p").filter({ hasText: "בחינה סופית" })
    await examRows.first().waitFor()
    assert.equal(await examRows.count(), 2, "shared dates across selected groups appear once")
    assert.match(await examRows.first().innerText(), /27\.6\.2027/)
    if (process.env.DIBIT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/annual-ready-${width}.png`, fullPage: true })
    await page.getByRole("button", { name: "תרגול מבחנים", exact: true }).click()
    await page.locator("#content").getByRole("button", { name: /צרפתית למתחילים/ }).waitFor()
    await page.getByRole("button", { name: "תוכנית", exact: true }).click()
    await page.locator("#content").getByText("צרפתית למתחילים (21721600)", { exact: true }).waitFor()
    assert.equal(await page.getByText("אין מועדי בחינות שפורסמו", { exact: true }).count(), 0)
    await page.getByRole("button", { name: "מבחנים", exact: true }).click()
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    const download = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: "ייצוא ל-Apple/Google Calendar", exact: true }).click()
    const chunks = []
    for await (const chunk of await (await download).createReadStream()) chunks.push(chunk)
    const calendar = Buffer.concat(chunks).toString()
    assert.ok(calendar.includes("20270627") && calendar.includes("20270722"))
    assert.equal(calendar.match(/BEGIN:VEVENT/g)?.length, 6, "four lessons and two exams")
    await page.getByRole("button", { name: "חיפוש קורסים לפי תאריך בחינה", exact: true }).click()
    await page.getByLabel("תאריך / מתאריך", { exact: true }).fill("2027-06-27")
    await page.getByText("1 קורסים · 1 מבחנים", { exact: true }).waitFor()
    await page.getByRole("button", { name: "חזרה למבחנים שלי", exact: true }).click()
    const card = page.locator("#course-21721600")
    await card.getByRole("checkbox", { name: /^קבוצה 01/ }).uncheck()
    await card.getByRole("checkbox", { name: /^קבוצה 02/ }).uncheck()
    await page.getByText("אין מבחנים להצגה.", { exact: false }).waitFor()
    await card.getByRole("checkbox", { name: /^קבוצה 01/ }).check()
    await examRows.first().waitFor()
    await page.locator("#semester-selector").click()
    await page.getByRole("option").nth(0).click()
    await page.getByText("אין מבחנים להצגה.", { exact: false }).waitFor()
    assert.equal(await examRows.count(), 0, "annual finals do not leak into semester A")
    await page.locator("#semester-selector").click()
    await page.getByRole("option").nth(1).click()
    await examRows.first().waitFor()
    assert.equal(await examRows.count(), 2)
    failFeed = true
    await page.reload()
    await examRows.first().waitFor()
    assert.equal(await examRows.count(), 2, "cached dates survive a feed outage")
    await page.getByRole("alert").filter({ hasText: "אינם עדכניים" }).waitFor()
    if (process.env.DIBIT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/annual-stale-${width}.png`, fullPage: true })
    failFeed = false
    currentAnnual = { ...annual, exams: { "21721600": {
      verifiedAt: "2099-01-03T00:00:00Z",
      groups: { "01": [{ date: "28/07/2027", moed: "א", type: "בחינה סופית" }],
        "02": [{ date: "29/07/2027", moed: "א", type: "בחינה סופית" }] },
    } } }
    const refresh = async () => {
      await page.getByRole("button", { name: "הגדרות", exact: true }).click()
      await page.getByRole("button", { name: "רענון נתוני קורסים שנתיים", exact: true }).click()
      await page.waitForFunction(expected => JSON.parse(localStorage.getItem("Annual Course Registry")).years["2027"].exams["21721600"].verifiedAt === expected, currentAnnual.exams["21721600"].verifiedAt)
      await page.getByRole("button", { name: "מבחנים", exact: true }).click()
    }
    await refresh()
    await examRows.first().waitFor()
    assert.equal(await examRows.count(), 1, "changed dates replace the old sitting")
    assert.match(await examRows.first().innerText(), /28\.7\.2027/)
    await page.getByText("יולי 2027", { exact: true }).waitFor()
    await page.getByRole("button", { name: "חיפוש קורסים לפי תאריך בחינה", exact: true }).click()
    await page.getByLabel("תאריך / מתאריך", { exact: true }).fill("2027-07-29")
    await page.getByText("1 קורסים · 1 מבחנים", { exact: true }).waitFor()
    await card.getByRole("checkbox", { name: /^קבוצה 01/ }).uncheck()
    await page.getByText("1 קורסים · 1 מבחנים", { exact: true }).waitFor()
    await card.getByRole("checkbox", { name: /^קבוצה 01/ }).check()
    await page.getByRole("button", { name: "חזרה למבחנים שלי", exact: true }).click()
    currentAnnual = { ...annual, exams: { "21721600": {
      verifiedAt: "2099-01-04T00:00:00Z", groups: { "01": [], "02": [] },
    } } }
    await refresh()
    await page.getByText("אין מבחנים להצגה.", { exact: false }).waitFor()
    assert.equal(await examRows.count(), 0, "cancellation clears cached dates")
    await page.getByRole("button", { name: "תוכנית", exact: true }).click()
    await page.getByText("אין מועדי בחינות שפורסמו", { exact: true }).waitFor()
    await page.getByRole("button", { name: "מבחנים", exact: true }).click()
    assert.deepEqual(errors, [])
    if (process.env.DIBIT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/annual-exams-${width}.png`, fullPage: true })
    await page.close()
    console.log(`PASS annual exams ${width}px: delayed feed, French dates, deduplication, calendar, search, deselection, semester switch, offline cache, corrected dates, selection-independent discovery, cancellation`)
  }
} finally {
  await browser?.close()
  await server.close()
}
