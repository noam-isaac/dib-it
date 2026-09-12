import assert from "node:assert/strict"
import { chromium, firefox, webkit } from "playwright"
import { createServer } from "vite"

const engine = process.env.DIBIT_BROWSER ?? "chromium"
const id = "08813126"
const semester = "2027a"
const courseName = "קורס בדיקה"
const lecture = lecturer => ({ group: "01", lecturer, lessons: [{ day: "א", time: "10:00-12:00", type: "שיעור" }] })
const catalog = { [id]: { name: courseName, groups: [lecture(null)], exams: [{ date: "01/02/2027", moed: "א" }] } }
const invalidCatalog = { ...catalog, "99999999": { name: "קורס אחר", groups: [{ group: "01", lessons: [{ day: 42 }] }] } }
const selections = { [semester]: [{ id, groups: ["01"] }] }
const server = await createServer({ cacheDir: `node_modules/.vite-test-validation-${engine}`,
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' }, server: { host: "127.0.0.1", port: 0 },
})
let browser
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await ({ chromium, firefox, webkit })[engine].launch()
  const openPage = async (respond, tab = "schedule") => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(5000)
    await page.route("**/*", route => new URL(route.request().url()).origin === url ? route.continue() : route.abort())
    await page.route("https://arazim-project.com/data/**", route => {
      const filename = new URL(route.request().url()).pathname.split("/").pop()
      return route.fulfill({ json: respond(filename) ?? (filename === "info.json"
        ? { currentSemester: semester, semesters: { [semester]: {} } }
        : filename === "courses.json" ? { [id]: { semesters: ["2024a"] } }
          : filename === `courses-${semester}.json` ? catalog : {}) })
    })
    await page.addInitScript(({ semester, selections, tab }) => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      localStorage.setItem("Dib It", JSON.stringify({ semester, courses: selections, tab }))
    }, { semester, selections, tab })
    await page.goto(url)
    return page
  }
  const assertSelections = async page => assert.deepEqual(await page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem("Dib It"))
    return workspace.plans?.find(plan => plan.id === workspace.activePlanId)?.courses ?? workspace.courses
  }), selections)
  const openPractice = async page => {
    await page.getByText("שעות: 2", { exact: true }).waitFor()
    await page.getByRole("button", { name: `${courseName} (${id})`, exact: true }).click()
  }
  const scenarios = [
    ["rejected HTTP-200 semester catalog refetches on retry", async () => {
      let requests = 0
      const page = await openPage(filename => filename === `courses-${semester}.json`
        ? (++requests === 1 ? invalidCatalog : catalog) : undefined)
      try {
        await page.getByRole("alert").filter({ hasText: "לא ניתן לטעון" }).waitFor()
        await assertSelections(page)
        await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click()
        await page.getByText("שעות: 2", { exact: true }).waitFor()
        assert.equal(requests, 2)
        await page.locator(`#course-${id}`).getByRole("checkbox", { name: /^קבוצה 01/ }).waitFor()
        await assertSelections(page)
      } finally { await page.close() }
    }],
    ["invalid historical data stays local, preserves workspace, and recovers on retry", async () => {
      let requests = 0
      const errors = []
      const page = await openPage(filename => filename === "courses-2024a.json"
        ? (++requests === 1 ? invalidCatalog : { [id]: { ...catalog[id], groups: [lecture("מרצה היסטורי")] } }) : undefined, "practice")
      page.on("pageerror", error => errors.push(error.message))
      try {
        await openPractice(page)
        const retry = page.getByRole("button", { name: "טעינת פרטי הסמסטר נכשלה — ניסיון נוסף", exact: true })
        await retry.waitFor()
        assert.equal(await page.getByRole("heading", { name: "לא ניתן להציג את המערכת", exact: true }).count(), 0)
        await assertSelections(page)
        // The main schedule and its selected group remain usable while history has failed.
        assert.equal(await page.locator(`#course-${id}`).getByRole("checkbox", { name: /^קבוצה 01/ }).isChecked(), true)
        await page.getByRole("checkbox", { name: "מועד א׳", exact: true }).check()
        assert.equal(await page.getByRole("checkbox", { name: "מועד א׳", exact: true }).isChecked(), true)
        await retry.click()
        await page.getByText(/\(מרצה היסטורי\)/).waitFor()
        assert.equal(requests, 2)
        assert.equal(await retry.count(), 0)
        await assertSelections(page)
        const practiced = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).practicedExams)
        assert.deepEqual(practiced, { [id]: ["2024aa"] })
        assert.deepEqual(errors, [])
      } finally { await page.close() }
    }],
    ...[null, "", " , ", "מרצה ראשי"].map(lecturer => [`lecturer fallback for ${JSON.stringify(lecturer)}`, async () => {
      const page = await openPage(filename => filename === "courses-2024a.json" ? { [id]: { ...catalog[id], groups: [
        lecture(lecturer), { group: "02", lecturer: "מר אברג'ל ברק", lessons: [{ type: "תרגיל" }] },
      ] } } : undefined, "practice")
      try {
        await openPractice(page)
        const expected = lecturer === "מרצה ראשי" ? "מרצה ראשי" : "מר אברג'ל ברק"
        await page.getByText(`(${expected})`, { exact: false }).waitFor()
        if (lecturer === "מרצה ראשי") assert.equal(await page.getByText(/\(מר אברג'ל ברק\)/).count(), 0)
        await assertSelections(page)
      } finally { await page.close() }
    }]),
  ]
  const failures = await scenarios.reduce(async (previous, [name, run]) => {
    const failed = await previous
    try { await run(); console.log(`PASS ${engine}: ${name}`); return failed }
    catch (error) { console.error(`FAIL ${engine}: ${name}\n${error.message}`); return [...failed, name] }
  }, Promise.resolve([]))
  assert.deepEqual(failures, [], "Catalog validation regressions")
} finally {
  await browser?.close()
  await server.close()
}
