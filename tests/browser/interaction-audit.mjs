import { prepareAnnualFeed } from "./annual-fixture.mjs"
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({
  plugins: [{
    name: "freeze-react-snapshots",
    enforce: "pre",
    transform(code, id) {
      const replacement = id.endsWith("/src/models.ts")
        ? ["return [view, update] as const", "return [freezeSnapshot(view), update] as const"]
        : id.endsWith("/src/hooks.ts")
          ? ["return [value, userSetValue] as const", "return [freezeSnapshot(value), userSetValue] as const"]
          : id.endsWith("/src/components/AutoBidModal.tsx")
            ? ["  return (", "  freezeSnapshot(possibleFaculties)\n  return ("] : null
      if (!replacement) return
      assert.ok(code.includes(replacement[0]), "snapshot freezing must stay connected to the state boundary")
      return code.replace(...replacement) + `
        function freezeSnapshot(value) {
          if (value && typeof value === "object" && !Object.isFrozen(value)) {
            Object.values(value).forEach(freezeSnapshot)
            Object.freeze(value)
          }
          return value
        }`
    },
  }],
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
  const errors = [], historyRequests = [], metadataRequests = []
  let releaseCatalog
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve })
  let failBidding = true
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
    const filename = url.pathname.split("/").pop()
    if (filename === "courses-2026a.json") await catalogGate
    if (filename === "courses.json" || filename === "grades.json") metadataRequests.push(filename)
    if (filename === "bidding.json") return failBidding
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({ json: { [ids[0]]: { "2025a": { "01": [{ faculty: "A", minimal: 10 }, { faculty: "B", minimal: 20 }] } } } })
    if (filename === "courses-2024a.json") historyRequests.push(filename)
    const json = filename === "info.json" ? { currentSemester: "2026a", semesters: { "2026a": {}, "2026b": {} } }
      : filename.startsWith("courses-") ? catalog
      : filename === "plans-2026.json" ? { Faculty: { Program: { Required: { count: 1, courses: { [ids[0]]: {} } } } } }
      : filename === "courses.json" ? Object.fromEntries(ids.map(id => [id, { semesters: ["2024a"] }])) : {}
    return route.fulfill({ json })
  })
  await page.addInitScript(ids => {
    localStorage.setItem("Dib It Fork Intro Seen", "true")
    localStorage.setItem("Auto Bid Faculty Points", JSON.stringify([{ faculty: "A", points: 100 }, { faculty: "B", points: 200 }]))
    localStorage.setItem("Dib It", JSON.stringify({ semester: "2026a", tab: "practice", degreeStartYear: "2026", school: "Faculty", studyPlan: "Program", courses: { "2026a": ids.map(id => ({ id, groups: ["01"] })) } }))
  }, ids)
  await prepareAnnualFeed(page)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await page.getByRole("button", { name: "פעולות", exact: true }).waitFor()
  assert.deepEqual(metadataRequests, [], "card metadata must wait for the selected catalog")
  assert.equal(await page.locator("#course-list > .card").count(), 0, "cards wait for the selected catalog")
  releaseCatalog()
  const first = page.getByRole("button", { name: `קורס 1 (${ids[0]})`, exact: true })
  const second = page.getByRole("button", { name: `קורס 2 (${ids[1]})`, exact: true })
  await first.waitFor()
  await page.waitForTimeout(200)
  assert.equal(historyRequests.length, 0, "collapsed practice panels must not fetch historical catalogs")
  assert.equal(await page.locator("#course-list").isVisible(), true)
  assert.equal(await page.getByRole("button", { name: /^(הסתרת|הצגת) קורסים/ }).count(), 0, "mobile course cards stay visible without a toggle")
  await second.evaluate(async (button, firstId) => {
    const { getWorkspace } = await import("/src/models.ts")
    const workspace = getWorkspace()
    workspace.openedPracticeCourses = [firstId]
    localStorage.setItem("Dib It", JSON.stringify(workspace))
    button.click()
  }, ids[0])
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).openedPracticeCourses), ids,
    "opening a stale practice panel preserves panels opened by another writer")
  await page.getByText("2024א'", { exact: true }).last().waitFor()
  assert.equal(historyRequests.length, 1)
  await page.getByRole("region", { name: `קורס 2 (${ids[1]})`, exact: true }).getByRole("checkbox", { name: "מועד א׳", exact: true }).check()
  await page.evaluate(async () => {
    const { getDibIt, setDibIt } = await import("/src/models.ts")
    const view = getDibIt()
    view.courses[view.semester].shift()
    setDibIt(view)
  })
  assert.equal(await second.getAttribute("aria-expanded"), "true", "removing an earlier exam must not change the expanded course")
  assert.equal(await page.getByRole("checkbox", { name: "מועד א׳", exact: true }).isChecked(), true)
  await page.setViewportSize({ width: 1280, height: 800 })
  assert.equal(await page.locator("#course-list").isVisible(), true, "desktop shows course cards")
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
  await page.getByRole("checkbox", { name: "A", exact: true }).check()
  await page.getByRole("textbox", { name: "מסלול בבידינג", exact: true }).first().fill("A updated")
  await page.getByRole("textbox", { name: "מסלול בבידינג", exact: true }).first().fill("A")
  await page.getByLabel("נקודות בבידינג", { exact: true }).first().fill("101")
  await page.getByLabel("נקודות בבידינג", { exact: true }).first().fill("100")
  await page.getByRole("button", { name: "הוספת מסלול בבידינג", exact: true }).click()
  await page.getByRole("button", { name: "מחיקת מסלול בבידינג", exact: true }).last().click()
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Auto Bid Faculty Points"))), [{ faculty: "A", points: 100 }, { faculty: "B", points: 200 }])
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
  // Both existing and newly added courses must receive group focus on mobile.
  await page.getByRole("button", { name: "בחירת קבוצות", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.matches('#course-22222222 input[type="checkbox"]'))
  assert.equal(await page.locator("#course-list").isVisible(), true)
  await page.getByLabel("תאריך / מתאריך").fill("2026-02-01")
  await page.getByRole("button", { name: "הוספת קורס", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.matches('#course-11111111 input[type="checkbox"]'))
  assert.equal(await page.locator("#course-list").isVisible(), true)

  // Course selection changes the results, never the dataset being indexed.
  await page.evaluate(async catalog => {
    const { prepareSearch } = await import("/src/search.ts")
    const { lautmanCourses } = await import("/src/lautmanCourses.ts")
    const options = Object.entries({ ...catalog, ...lautmanCourses })
      .map(([id, course]) => ({ label: `${course.name} (${id})` }))
      .sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
    const prototype = Object.getPrototypeOf(prepareSearch(options))
    const addAll = prototype.addAll
    window.indexRebuilds = 0
    prototype.addAll = function (...args) { window.indexRebuilds++; return addAll.apply(this, args) }
  }, catalog)
  const search = page.getByPlaceholder("חיפוש קורסים להוספה")
  const option = page.getByRole("option", { name: `קורס 1 (${ids[0]})`, exact: true })
  await page.locator(`#course-${ids[0]}`).getByRole("button", { name: "הסרת הקורס", exact: true }).click()
  await search.fill("קורס")
  await option.click()
  await page.locator(`#course-${ids[0]}`).waitFor()
  await search.fill("קורס")
  assert.equal(await option.count(), 0, "selected courses must be excluded from search results")
  await page.locator(`#course-${ids[0]}`).getByRole("button", { name: "הסרת הקורס", exact: true }).click()
  await search.click()
  await option.waitFor()
  assert.equal(await page.evaluate(() => window.indexRebuilds), 0, "adding/removing a course must reuse the full catalog index")
  await option.click()
  const card = page.locator(`#course-${ids[0]}`)
  await card.getByRole("button", { name: "הזזת הקורס למעלה", exact: true }).click()
  assert.deepEqual(await page.locator("#course-list > .card").evaluateAll(cards => cards.map(card => card.id)), ids.map(id => `course-${id}`))
  await card.getByRole("button", { name: "הזזת הקורס למטה", exact: true }).click()
  await card.getByRole("textbox").fill("#123456")
  assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses["2026a"].find(course => course.id === id).color, ids[0]), "#123456")
  await page.getByRole("button", { name: "הגדרות", exact: true }).click()
  await page.getByRole("textbox", { name: "עיצוב", exact: true }).click()
  await page.getByRole("option", { name: "גוגל", exact: true }).click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).theme), "google")
  await page.locator("#semester-selector").click()
  await page.getByRole("option", { name: "תשפ״ו ב'", exact: true }).click()
  await page.getByRole("button", { name: "תוכנית", exact: true }).click()
  await page.getByRole("button", { name: /הוספה$/ }).click()
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].courses["2026b"].map(course => course.id)), [ids[0]])
  assert.deepEqual(errors, [])
  console.log("PASS frozen React snapshots: metadata ordering, search, focus, practice, bidding, course reorder/color/remove, theme, semester and study-plan edits")
} finally {
  await browser?.close()
  await server.close()
}
