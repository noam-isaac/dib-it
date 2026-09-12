import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ cacheDir: "node_modules/.vite-test-readiness",
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  server: { host: "127.0.0.1", port: 0 },
})
const id = "12345678"
const catalog = { [id]: { name: "קורס בדיקה", groups: [{ group: "01", lessons: [{ day: "א", time: "09:00-10:00", type: "שיעור" }] }], exams: [{ date: "01/02/2026", moed: "א" }] } }
const plans = year => ({ "פקולטה": { "תוכנית": { [`קטגוריה ${year}`]: { courses: { [id]: { id, weight: "2" } }, count: 1 } } } })
let browser
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  const pending = new Map(["courses.json", "grades.json", "plans-2026.json", "plans-2025.json", "plans-2024.json", "courses-2023a.json"].map(file => [file, Promise.withResolvers()]))
  const request = file => Promise.race([
    pending.get(file).promise,
    new Promise((_, reject) => { setTimeout(() => reject(new Error(`No request for ${file}`)), 10000).unref() }),
  ])
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", route => new URL(route.request().url()).origin === url ? route.continue() : route.abort())
  await page.route("https://arazim-project.com/data/**", route => {
    const file = new URL(route.request().url()).pathname.split("/").pop()
    if (pending.has(file)) { pending.get(file).resolve(route); return }
    return route.fulfill({ json: file === "info.json" ? { currentSemester: "2026a", semesters: { "2024a": {}, "2025a": {}, "2026a": {} } } : catalog })
  })
  const release = async (file, json, status = 200) => {
    const route = await request(file)
    pending.set(file, Promise.withResolvers())
    await route.fulfill({ json, status })
  }
  await page.addInitScript(id => {
    localStorage.setItem("Dib It Fork Intro Seen", "true")
    localStorage.setItem("Dib It", JSON.stringify({ semester: "2026a", tab: "schedule", degreeStartYear: "2026", school: "פקולטה", studyPlan: "תוכנית", courses: { "2026a": [{ id, groups: ["01"] }] } }))
  }, id)
  await page.goto(url)
  await page.locator("#schedule-container").waitFor()
  await request("grades.json")
  assert.equal(await page.locator("#course-list .card").count(), 0)
  await release("courses.json", { [id]: { name: "קורס בדיקה", semesters: ["2023a"] } })
  assert.equal(await page.locator("#course-list .card").count(), 0, "cards wait for grades as well as course metadata")
  await release("grades.json", {}, 503)
  const error = page.getByRole("alert").filter({ hasText: `לא ניתן לטעון את פרטי הקורס ${id}` })
  await error.waitFor()
  await error.getByRole("button", { name: "ניסיון נוסף" }).click()
  await release("grades.json", {})
  await page.locator(`#course-${id}`).waitFor()

  await page.getByRole("button", { name: "תוכנית", exact: true }).click()
  await request("plans-2026.json")
  assert.equal(await page.getByRole("heading", { name: "קטגוריה 2026" }).count(), 0)
  await release("plans-2026.json", plans("2026"))
  await page.getByRole("heading", { name: "קטגוריה 2026" }).waitFor()
  const year = page.getByRole("textbox", { name: "שנת התחלת התואר", exact: true })
  await year.click()
  await page.getByRole("option", { name: "2025", exact: true }).click()
  await request("plans-2025.json")
  assert.equal(await page.getByRole("heading", { name: "קטגוריה 2026" }).count(), 0, "old-year data is hidden while the new year loads")
  await year.click()
  await page.getByRole("option", { name: "2024", exact: true }).click()
  await release("plans-2025.json", plans("2025"))
  assert.equal(await page.getByRole("heading", { name: /קטגוריה/ }).count(), 0)
  await release("plans-2024.json", plans("2024"))
  await page.getByRole("heading", { name: "קטגוריה 2024" }).waitFor()
  assert.equal(await page.getByRole("heading", { name: "קטגוריה 2025" }).count(), 0)

  await page.getByRole("button", { name: "תרגול מבחנים", exact: true }).click()
  await page.getByRole("button", { name: `קורס בדיקה (${id})`, exact: true }).click()
  await request("courses-2023a.json")
  assert.equal(await page.getByText("2023א'", { exact: true }).count(), 0, "historical details wait for their semester data")
  await release("courses-2023a.json", catalog)
  await page.getByText("2023א'", { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log("PASS data readiness: metadata joins, failure/retry, study-plan year races, historical practice rows")
} finally {
  await browser?.close()
  await server.close()
}
