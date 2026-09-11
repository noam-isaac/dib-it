import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  cacheDir: "node_modules/.vite-interaction-test",
  server: { host: "127.0.0.1", port: 0 },
})
const ids = ["11111111", "22222222"]
const catalog = Object.fromEntries(ids.map((id, index) => [id, {
  name: `קורס ${index + 1}`, groups: [{ group: "01", lessons: [{ day: "א", time: "08:00-10:00", type: "שיעור" }] }],
  exams: [{ date: `${index + 1}/02/2026`, moed: "א" }],
}]))
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const errors = [], historyRequests = []
  let failBidding = true
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", route => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1") return route.continue()
    const filename = url.pathname.split("/").pop()
    if (filename === "bidding.json") return failBidding
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({ json: { [ids[0]]: { "2025a": { "01": [{ faculty: "A", minimal: 10 }, { faculty: "B", minimal: 20 }] } } } })
    if (filename === "courses-2024a.json") historyRequests.push(filename)
    const json = filename === "info.json" ? { currentSemester: "2026a", semesters: { "2026a": {} } }
      : filename.startsWith("courses-") ? catalog
      : filename === "courses.json" ? Object.fromEntries(ids.map(id => [id, { semesters: ["2024a"] }])) : {}
    return route.fulfill({ json })
  })
  await page.addInitScript(ids => {
    localStorage.setItem("Dib It Fork Intro Seen", "true")
    localStorage.setItem("Auto Bid Faculty Points", JSON.stringify([{ faculty: "A", points: 100 }, { faculty: "B", points: 200 }]))
    localStorage.setItem("Dib It", JSON.stringify({ semester: "2026a", tab: "practice", courses: { "2026a": ids.map(id => ({ id, groups: ["01"] })) } }))
  }, ids)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const first = page.getByRole("button", { name: `קורס 1 (${ids[0]})`, exact: true })
  const second = page.getByRole("button", { name: `קורס 2 (${ids[1]})`, exact: true })
  await first.waitFor()
  await page.waitForTimeout(200)
  assert.equal(historyRequests.length, 0, "collapsed practice panels must not fetch historical catalogs")
  const before = await first.boundingBox()
  await page.getByRole("button", { name: "הסתרת קורסים (2)", exact: true }).click()
  assert.equal(await page.locator("#course-list").isVisible(), false)
  assert.ok((await first.boundingBox()).y < before.y, "collapsing course cards exposes navigation and content")
  await second.click()
  await page.getByText("2024א'", { exact: true }).waitFor()
  assert.equal(historyRequests.length, 1)
  await page.getByRole("checkbox", { name: "מועד א׳", exact: true }).check()
  await page.evaluate(async () => {
    const { getDibIt, setDibIt } = await import("/src/models.ts")
    const view = getDibIt()
    view.courses[view.semester].shift()
    setDibIt(view)
  })
  assert.equal(await second.getAttribute("aria-expanded"), "true", "removing an earlier exam must not change the expanded course")
  assert.equal(await page.getByRole("checkbox", { name: "מועד א׳", exact: true }).isChecked(), true)
  await page.setViewportSize({ width: 1280, height: 800 })
  assert.equal(await page.locator("#course-list").isVisible(), true, "desktop still shows cards after mobile collapse")
  assert.equal(await page.locator(".course-list-toggle").isVisible(), false)
  await page.getByRole("button", { name: "פעולות", exact: true }).click()
  await page.getByRole("menuitem", { name: "המלצות בידינג אוטומטיות", exact: true }).click()
  const calculate = page.getByRole("button", { name: "חישוב המלצות (2, 3 - שג׳ר!)", exact: true })
  await calculate.click()
  await page.getByRole("alert").filter({ hasText: "לא ניתן לחשב" }).waitFor()
  assert.equal(await calculate.isEnabled(), true, "failed request must release the calculate button")
  failBidding = false
  await calculate.click()
  await page.getByText(/לא חושבה המלצה לקורסים/).waitFor()
  await page.getByRole("checkbox", { name: "A", exact: true }).uncheck()
  assert.equal(await page.getByRole("heading", { name: "מסלול: A", exact: true }).count(), 0, "editing mappings clears stale results")
  await page.keyboard.press("Escape")
  await page.evaluate(async () => {
    const { getDibIt, setDibIt } = await import("/src/models.ts")
    const view = getDibIt()
    view.courses[view.semester][0].groups = []
    setDibIt(view)
  })
  await page.getByText(/אין מבחנים לתרגול בקורסים שנבחרו/).waitFor()
  await page.evaluate(async () => {
    const { getDibIt, setDibIt } = await import("/src/models.ts")
    const view = getDibIt()
    view.courses[view.semester][0].groups = ["01"]
    setDibIt(view)
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "מבחנים", exact: true }).click()
  await page.getByRole("button", { name: "חיפוש מבחנים בתאריך 2026-02-02", exact: true }).click()
  // The earlier mobile collapse is still active; both existing and new courses must reveal it.
  await page.getByRole("button", { name: "בחירת קבוצות", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.matches('#course-22222222 input[type="checkbox"]'))
  assert.equal(await page.locator("#course-list").isVisible(), true)
  await page.getByRole("button", { name: "הסתרת קורסים (1)", exact: true }).click()
  await page.getByLabel("תאריך / מתאריך").fill("2026-02-01")
  await page.getByRole("button", { name: "הוספת קורס", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.matches('#course-11111111 input[type="checkbox"]'))
  assert.equal(await page.locator("#course-list").isVisible(), true)
  assert.deepEqual(errors, [])
  console.log("PASS mobile collapse, practice lazy loading and stable expansion, bidding failure/retry/missing data/stale results, empty practice")
} finally {
  await browser?.close()
  await server.close()
}
