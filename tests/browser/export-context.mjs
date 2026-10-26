import assert from "node:assert/strict"
import { chromium, firefox, webkit } from "playwright"
import { createServer } from "vite"
import { prepareAnnualFeed } from "./annual-fixture.mjs"

const engine = process.env.DIBIT_BROWSER ?? "chromium"
const server = await createServer({
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  cacheDir: "node_modules/.vite-export-context-test",
  server: { host: "127.0.0.1", port: 0 },
})
let browser
let releaseCatalog
const pendingCatalog = new Promise(resolve => { releaseCatalog = resolve })
try {
  await server.listen()
  browser = await { chromium, firefox, webkit }[engine].launch()
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
    if (url.pathname.includes("courses-2026b")) await pendingCatalog
    const semester = url.pathname.includes("2026b") ? "2026b" : "2026a"
    return route.fulfill({ json: url.pathname.endsWith("info.json")
      ? { currentSemester: "2026a", semesters: { "2026a": {}, "2026b": {} } }
      : url.pathname.includes("courses-") ? Object.fromEntries(["11111111", "22222222"].map(id => [id, {
        name: `${semester} Course ${id}`, groups: [{ group: "01", lessons: [{ day: "א", time: "10:00-12:00" }] }],
        exams: [{ date: "15/02/2026", moed: "א", type: "בחינה סופית" }],
      }])) : {} })
  })
  await prepareAnnualFeed(page)
  await page.addInitScript(() => {
    localStorage.setItem("Dib It Fork Intro Seen", "true")
    localStorage.setItem("Dib It", JSON.stringify({ semester: "2026a", tab: "exams", activePlanId: "first", plans:
      ["first", "second"].map((id, index) => ({ id, name: id, courses: Object.fromEntries(["2026a", "2026b"].map(semester =>
        [semester, [{ id: index ? "22222222" : "11111111", groups: ["01"] }]])) })) }))
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const content = page.locator("#export-content")
  const dialog = page.getByRole("dialog")
  const open = async () => {
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    await page.getByRole("menuitem", { name: "ייצוא ל־PDF או לתמונה", exact: true }).click()
    await dialog.getByRole("button", { name: "שמירת תמונה (PNG)", exact: true }).waitFor()
  }
  const update = patch => page.evaluate(async patch => {
    const { getWorkspace, setWorkspace } = await import("/src/models.ts")
    setWorkspace({ ...getWorkspace(), ...patch })
  }, patch)
  await content.getByText("2026a Course 11111111", { exact: true }).waitFor()
  await open()
  await update({ semester: "2026b" })
  await dialog.waitFor({ state: "hidden" })
  await page.getByText("טוען את הקורסים של הסמסטר...", { exact: true }).waitFor()
  releaseCatalog()
  await content.getByText("2026b Course 11111111", { exact: true }).waitFor()
  assert.equal(await dialog.count(), 0, "catalog completion cannot reopen the old chooser")
  await open()
  await update({ activePlanId: "second" })
  await dialog.waitFor({ state: "hidden" })
  await content.getByText("2026b Course 22222222", { exact: true }).waitFor()
  await open()
  await update({ tab: "guide" })
  await dialog.waitFor({ state: "hidden" })
  await update({ tab: "exams" })
  await content.getByText("2026b Course 22222222", { exact: true }).waitFor()
  assert.equal(await dialog.count(), 0, "returning to the previous view cannot reopen the chooser")

  await page.evaluate(() => {
    // A decoy ID must not route capture away from the element owned by React.
    const decoy = document.createElement("div")
    decoy.id = "export-content"
    decoy.textContent = "WRONG EXPORT TARGET"
    document.body.prepend(decoy)
    const original = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.capturedText = document.querySelector("[inert] #export-content").textContent
      window.finishEncoding = () => original.apply(this, args)
    }
  })
  await open()
  const downloading = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "שמירת תמונה (PNG)", exact: true }).click()
  await page.waitForFunction(() => typeof window.finishEncoding === "function")
  await update({ semester: "2026a" })
  await dialog.waitFor({ state: "hidden" })
  await page.locator("#content #export-content").getByText("2026a Course 22222222", { exact: true }).waitFor()
  await open()
  assert.equal(await dialog.getByRole("status").count(), 0, "a reopened chooser starts idle")
  await page.evaluate(() => window.finishEncoding())
  const download = await downloading
  assert.equal(download.suggestedFilename(), "dibit-2026b.png", "an in-flight export keeps its captured semester")
  assert.match(await page.evaluate(() => window.capturedText), /2026b Course 22222222/)
  assert.doesNotMatch(await page.evaluate(() => window.capturedText), /2026a|WRONG EXPORT TARGET/)
  await page.waitForFunction(() => !document.querySelector("[inert] #export-content"))
  assert.equal(await dialog.getByRole("status").count(), 0, "old completion cannot change a reopened chooser")
  assert.equal(await dialog.getByRole("button", { name: "שמירת תמונה (PNG)", exact: true }).isEnabled(), true)
  assert.deepEqual(errors, [])
  console.log(`PASS export context ${engine}: loading, plan, semester, tab, explicit ref, asynchronous completion`)
} finally {
  releaseCatalog()
  await browser?.close()
  await server.close()
}
