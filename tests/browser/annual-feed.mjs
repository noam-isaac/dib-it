import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

const server = await createServer({ cacheDir: "node_modules/.vite-test-annual-feed",
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  server: { host: "127.0.0.1", port: 0 },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  let pendingFeed, failFeed = false
  await page.route("**/*", route => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1") return route.continue()
    if (url.hostname === "raw.githubusercontent.com") {
      if (failFeed) return route.fulfill({ json: { version: 999, years: {} } })
      pendingFeed = route
      return
    }
    return route.fulfill({ json: url.pathname.endsWith("info.json") ? { currentSemester: "2095a", semesters: { "2095a": {}, "2095b": {} } }
      : url.pathname.includes("courses-") ? { "12345678": { name: "קורס שנתי לבדיקה", groups: [{ group: "01", lessons: [{ day: "א", time: "09:00-10:00" }] }] } } : {} })
  })
  await page.addInitScript(() => {
    localStorage.setItem("Dib It Fork Intro Seen", "true")
    if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify({ semester: "2095a", courses: {
      "2095a": [{ id: "12345678", groups: ["01"] }], "2095b": [{ id: "12345678", groups: ["01"] }],
    } }))
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const card = page.locator("#course-12345678")
  await card.waitFor()
  await card.getByRole("button", { name: /הסרת/ }).click()
  const plan = () => page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0])
  assert.equal((await plan()).pendingAnnualChanges[0].awaitingClassification, true)
  await page.waitForFunction(() => performance.getEntriesByType("resource").some(entry => entry.name.includes("courses-2095b")))
  assert.ok(pendingFeed)
  await pendingFeed.fulfill({ json: { version: 1, years: { "2095": {
    source: "https://www.ims.tau.ac.il/Tal/KR/Search_P.aspx", filter: "ckSem=0", verifiedAt: "2026-09-09", groups: { "12345678": ["01"] },
  } } } })
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem("Dib It")).plans[0].pendingAnnualChanges)
  assert.deepEqual((await plan()).courses, { "2095a": [], "2095b": [] })
  const cached = await page.evaluate(() => localStorage.getItem("Annual Course Registry"))
  failFeed = true
  await page.reload()
  await page.getByRole("button", { name: "הגדרות", exact: true }).click()
  await page.getByText("אומתו לאחרונה: 2026-09-09", { exact: true }).waitFor()
  await page.getByRole("button", { name: "רענון נתוני קורסים שנתיים", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "הרענון נכשל" }).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem("Annual Course Registry")), cached)
  assert.deepEqual((await plan()).courses, { "2095a": [], "2095b": [] })
  assert.deepEqual(errors, [])
  console.log("PASS annual feed: deferred deletion, late classification, cached reload, unsupported version and retry preserve data")
} finally {
  await browser?.close()
  await server.close()
}
