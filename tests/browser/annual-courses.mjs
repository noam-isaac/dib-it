import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { createServer } from "vite"

const catalogs = JSON.parse(await readFile(new URL("../fixtures/annual-catalogs-2026.json", import.meta.url)))
const server = process.env.DIBIT_TEST_URL ? undefined : await createServer({ server: { host: "127.0.0.1", port: 0 } })
let browser
try {
  await server?.listen()
  browser = await chromium.launch()
  for (const semester of ["2026a", "2026b"]) {
    const other = semester === "2026a" ? "2026b" : "2026a"
    const context = await browser.newContext({ viewport: semester.endsWith("a")
      ? { width: 1280, height: 800 } : { width: 390, height: 844 } })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    let release
    const delayed = new Promise(resolve => { release = resolve })
    await page.route("https://arazim-project.com/data/**", async route => {
      const filename = new URL(route.request().url()).pathname.split("/").pop()
      if (filename === `courses-${other}.json`) await delayed
      const json = filename === "info.json" ? {
        currentSemester: semester, semesters: { "2026a": {}, "2026b": {} },
      } : catalogs[filename.slice(8, -5)] ?? {}
      await route.fulfill({ json })
    })
    await page.addInitScript(semester => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      localStorage.setItem("Dib It", JSON.stringify({ semester, tab: "schedule", courses: {} }))
    }, semester)
    await page.goto(process.env.DIBIT_TEST_URL ?? `http://127.0.0.1:${server.httpServer.address().port}`)
    await page.getByPlaceholder("חיפוש קורסים להוספה").fill("פרויקט שטח שנתי")
    await page.getByRole("option", { name: "פרויקט שטח שנתי (10313103)", exact: true }).click()
    await page.locator("#course-10313103").getByRole("checkbox").check()
    await page.locator("#course-10313103").getByText("שנתי", { exact: true }).waitFor()
    release()
    await page.waitForFunction(other => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses[other]?.[0]?.groups?.includes("01"), other)
    await page.locator("#semester-selector").click()
    await page.getByRole("option").nth(other.endsWith("a") ? 0 : 1).click()
    await page.locator("#course-10313103").getByRole("checkbox").waitFor()
    assert.equal(await page.locator("#course-10313103").getByRole("checkbox").isChecked(), true)
    await page.locator("#schedule-container").getByText("פרויקט שטח שנתי (פרוייקט)", { exact: true }).waitFor()
    await page.locator("#course-10313103").getByRole("checkbox").uncheck()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses)
    assert.deepEqual(stored[semester][0].groups, [])
    assert.deepEqual(stored[other][0].groups, [])
    await page.getByPlaceholder("חיפוש קורסים להוספה").fill("מעבדת פנטום")
    await page.getByRole("option", { name: "מעבדת פנטום (01911111)", exact: true }).click()
    const phantom = page.locator("#course-01911111")
    assert.equal(await phantom.getByText("שנתי", { exact: true }).count(), 0)
    await phantom.getByRole("checkbox", { name: "קבוצה 01", exact: true }).check()
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses)
    assert.equal(after[semester].some(course => course.id === "01911111"), false, "Repeated semester offerings must not synchronize")
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    if (process.env.DIBIT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/annual-${semester}.png` })
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS annual course ${semester}: delayed catalog, automatic addition, semester switch, group deselection`)
  }
} finally {
  await browser?.close()
  await server?.close()
}
