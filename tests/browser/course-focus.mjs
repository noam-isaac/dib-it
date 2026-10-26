import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { prepareAnnualFeed } from "./annual-fixture.mjs"

const id = "11111111"
const catalog = { [id]: {
  name: "Focus course", groups: [{ group: "01", lessons: [{ day: "א", time: "10:00-12:00" }] }],
  exams: [{ date: "15/02/2026", moed: "א" }],
} }
const server = await createServer({
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  cacheDir: "node_modules/.vite-course-focus",
  server: { host: "127.0.0.1", port: 0 },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const errors = []
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on("pageerror", error => errors.push(error.message))
    let releaseGrades
    const grades = new Promise(resolve => { releaseGrades = resolve })
    await page.route("**/*", async route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.startsWith("/data/")) return route.continue()
      const name = url.pathname.split("/").pop()
      if (name === "grades.json") await grades
      const json = name === "info.json" ? { currentSemester: "2026a", semesters: { "2026a": {}, "2026b": {} } }
        : name.startsWith("courses-") ? catalog
        : name === "courses.json" ? { [id]: { name: "Focus course", semesters: ["2026a", "2026b"] } } : {}
      return route.fulfill({ json })
    })
    await page.addInitScript(() => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      localStorage.setItem("Dib It", JSON.stringify({ semester: "2026a", tab: "exams", activePlanId: "first", plans: [
        { id: "first", name: "First plan", courses: {} },
        { id: "second", name: "Second plan", courses: {} },
      ] }))
    })
    await prepareAnnualFeed(page)
    await page.goto(origin)
    await page.getByRole("button", { name: "חיפוש קורסים לפי תאריך בחינה", exact: true }).click()
    await page.getByRole("button", { name: "הוספת קורס", exact: true }).click()
    await page.getByRole("status", { name: "טוען פרטי קורס", exact: true }).waitFor()
    // The old implementation already spent its only frame while the card was a loader.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return { page, context, releaseGrades }
  }
  {
    const { page, context, releaseGrades } = await open()
    releaseGrades()
    await page.waitForFunction(() => document.activeElement?.matches('#course-11111111 input[type="checkbox"]'))
    await page.getByRole("button", { name: "בחירת קבוצות", exact: true }).click()
    await page.waitForFunction(() => document.activeElement?.matches('#course-11111111 input[type="checkbox"]'))
    // Consuming a request must not refocus the card on later renders.
    await page.getByRole("button", { name: "סינון לפי קורס או פקולטה", exact: true }).click()
    await page.getByRole("textbox", { name: "שם או מספר קורס", exact: true }).fill("Focus")
    assert.equal(await page.getByRole("textbox", { name: "שם או מספר קורס", exact: true }).evaluate(node => node === document.activeElement), true)
    await page.locator("#course-11111111").getByRole("checkbox").check()
    await page.getByRole("button", { name: "מערכת", exact: true }).click()
    await page.locator("#schedule-container").getByText("Focus course", { exact: true }).click()
    await page.waitForFunction(() => document.activeElement?.matches('#course-11111111 input[type="checkbox"]') && document.getElementById("course-11111111").getAnimations().some(animation => animation.effect.getKeyframes().some(frame => frame.scale === "1.03")))
    await context.close()
  }
  {
    const { page, context, releaseGrades } = await open()
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    await page.getByRole("menuitem", { name: "ייצוא ל־PDF או לתמונה", exact: true }).click()
    await page.getByRole("dialog").waitFor()
    releaseGrades()
    await page.locator("#course-11111111").waitFor()
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true, "metadata completion must preserve dialog focus")
    await page.keyboard.press("Escape")
    await page.getByRole("dialog").waitFor({ state: "hidden" })
    assert.equal(await page.locator("#course-11111111").getByRole("checkbox").evaluate(node => node === document.activeElement), false)
    await context.close()
  }
  // Returning to the original context must not revive its abandoned request.
  for (const field of ["activePlanId", "semester"]) {
    const { page, context, releaseGrades } = await open()
    await page.evaluate(async field => {
      const { getWorkspace, setWorkspace } = await import("/src/models.ts")
      setWorkspace({ ...getWorkspace(), [field]: field === "activePlanId" ? "second" : "2026b" })
    }, field)
    await page.getByRole("status", { name: "טוען פרטי קורס", exact: true }).waitFor({ state: "hidden" })
    await page.evaluate(async field => {
      const { getWorkspace, setWorkspace } = await import("/src/models.ts")
      setWorkspace({ ...getWorkspace(), [field]: field === "activePlanId" ? "first" : "2026a" })
    }, field)
    await page.getByRole("status", { name: "טוען פרטי קורס", exact: true }).waitFor()
    releaseGrades()
    await page.locator("#course-11111111").waitFor()
    assert.equal(await page.locator("#course-11111111").getByRole("checkbox").evaluate(node => node === document.activeElement), false, `${field} navigation cancels pending focus`)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log("Course focus: delayed metadata, existing cards, schedule highlighting, dialog and context cancellation passed")
} finally {
  await browser?.close()
  await server.close()
}
