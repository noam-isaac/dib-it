import assert from "node:assert/strict"
import { chromium, firefox, webkit } from "playwright"
import { createServer } from "vite"

const engine = process.env.DIBIT_BROWSER ?? "chromium"
const semesters = ["2026a", "2027a", "2027b"]
const id = "12345678"
const catalog = semester => ({ [id]: { name: `קורס ${semester}`, groups: [
  { group: "01", lessons: [{ day: "א", time: "10:00-12:00", type: "שיעור" }] },
] } })
const server = await createServer({ cacheDir: `node_modules/.vite-test-loading-${engine}`,
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  server: { host: "127.0.0.1", port: 0 },
})
let browser
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await ({ chromium, firefox, webkit })[engine].launch()
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(10000)
    const pending = new Map(semesters.map(semester => [semester, Promise.withResolvers()]))
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("**/*", route => new URL(route.request().url()).origin === url ? route.continue() : route.abort())
    await page.route("https://arazim-project.com/data/**", route => {
      const filename = new URL(route.request().url()).pathname.split("/").pop()
      if (/^courses-\d{4}[ab]\.json$/.test(filename)) {
        pending.get(filename.slice(8, -5))?.resolve(route)
        return
      }
      return route.fulfill({ json: filename === "info.json"
        ? { currentSemester: "2027a", semesters: Object.fromEntries(semesters.map(s => [s, {}])) } : {} })
    })
    await page.addInitScript(({ semesters, id }) => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify({
        semester: "2027a", courses: Object.fromEntries(semesters.map(s => [s, [{ id, groups: ["01"] }]])),
      }))
    }, { semesters, id })
    const checkPending = async () => {
      await page.getByText("שעות: —", { exact: true }).waitFor()
      assert.equal(await page.locator("#course-list .card").count(), 0)
      assert.equal(await page.getByPlaceholder("חיפוש קורסים להוספה").isDisabled(), true)
      await page.getByRole("button", { name: "פעולות", exact: true }).click()
      for (const name of ["ייצוא ל-Apple/Google Calendar", "יצירת טופס רישום ב-Word", "ייצוא ל־PDF או לתמונה"]) {
        assert.equal(await page.getByRole("menuitem", { name, exact: true }).isDisabled(), true)
      }
      assert.equal(await page.getByRole("menuitem", { name: "גיבוי", exact: true }).isEnabled(), true)
      assert.equal(await page.getByRole("menuitem", { name: "מערכות שעות", exact: true }).isEnabled(), true)
      await page.getByRole("button", { name: "פעולות", exact: true }).click()
      await page.getByRole("menu").waitFor({ state: "hidden" })
    }
    const release = async (semester, status = 200) => {
      const route = await pending.get(semester).promise
      pending.set(semester, Promise.withResolvers())
      await route.fulfill({ status, json: status === 200 ? catalog(semester) : {} })
    }
    const switchTo = async semester => {
      await page.locator("#semester-selector").click()
      await page.getByRole("option").nth(semesters.indexOf(semester)).click()
    }
    await page.goto(url)
    await checkPending()
    await release("2027a")
    await page.getByText("שעות: 2", { exact: true }).waitFor()
    await switchTo("2027b")
    await checkPending()
    await switchTo("2026a")
    await release("2027b") // A late response from the previous year must not end loading.
    await checkPending()
    await release("2026a", 503)
    await page.getByRole("alert").filter({ hasText: "לא ניתן לטעון" }).waitFor()
    await checkPending()
    await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click()
    await release("2026a")
    await page.getByText("שעות: 2", { exact: true }).waitFor()
    await page.locator(`#course-${id}`).getByText(`קורס 2026a (${id})`, { exact: true }).waitFor()
    assert.equal(await page.getByPlaceholder("חיפוש קורסים להוספה").isEnabled(), true)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses)
    assert.deepEqual(saved, Object.fromEntries(semesters.map(s => [s, [{ id, groups: ["01"] }]])))
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${engine} ${width}: delayed catalogs, semester/year switch, stale response, failure/retry, preserved selections and backup access`)
  }
} finally {
  await browser?.close()
  await server.close()
}
