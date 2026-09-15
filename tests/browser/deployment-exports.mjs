import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { build } from "vite"
import { chromium } from "playwright"
import JSZip from "jszip"

// Keep A's filled form alive while the origin replaces its production files with B.
const output = await mkdtemp(join(tmpdir(), "dibit-deployment-exports-"))
const builds = [join(output, "a"), join(output, "b")]
let current = builds[0]
let browser
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname
  const file = pathname === "/" ? "index.html" : pathname.slice(1)
  try {
    const body = await readFile(join(current, file))
    response.writeHead(200, { "Cache-Control": "no-cache", "Content-Type":
      file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css"
        : file.endsWith(".html") ? "text/html" : "application/octet-stream" })
    response.end(body)
  } catch { response.writeHead(404); response.end("NOT_FOUND") }
})
const catalog = Object.fromEntries(["01234567", "01674567"].map((id, index) => [id, {
  name: `קורס בדיקה ${index + 1}`, faculty: `פקולטה/חוג בדיקה ${index + 1}`,
  groups: [{ group: "01", lessons: [{ day: index ? "ב" : "א", time: "10:00-12:00", type: "שיעור" }] }], exams: [],
}]))
const manifest = JSON.parse(await readFile(new URL("../../src/assets/registration-template.json", import.meta.url), "utf8"))
const choose = async (page, name) => {
  await page.getByRole("button", { name: "פעולות", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}
const download = async (page, name) => {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name, exact: true }).click(),
  ])
  return readFile(await file.path())
}
const verifyDoc = data => {
  assert.equal(data.length, manifest.byteLength)
  const name = manifest.slots.find(slot => slot.key === "studentName")
  const text = Array.from({ length: name.length }, (_, i) =>
    String.fromCharCode(data[name.offsets[2 * i]] | data[name.offsets[2 * i + 1]] << 8)).join("")
  assert.ok(text.startsWith("ישראל ישראלי"), "the exported DOC contains the unchanged form draft")
}
try {
  for (const [index, outDir] of builds.entries()) {
    await build({ logLevel: "error", build: { outDir, emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: `assets/[name]-${index}-[hash].js` } } },
      define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' } })
    const assets = await readdir(join(outDir, "assets"))
    assert.equal(assets.filter(file => file.endsWith(".js")).length, 1, "exporters are in the eager bundle")
    assert.equal(assets.some(file => file.endsWith(".doc")), false, "the template is embedded")
  }
  const entryA = (await readFile(join(builds[0], "index.html"), "utf8")).match(/src="([^"]+\.js)"/)[1]
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch()
  for (const width of [1280, 390]) {
    current = builds[0]
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.route("https://arazim-project.com/data/**", route => {
      const file = new URL(route.request().url()).pathname.split("/").pop()
      return route.fulfill({ json: file === "info.json" ? { currentSemester: "2026a", semesters: {
        "2026a": { startDate: "2025-10-26", endDate: "2026-01-25" } } } : file === "courses-2026a.json" ? catalog : {} })
    })
    await page.addInitScript(multiple => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      localStorage.setItem("Dib It", JSON.stringify({ semester: "2026a", tab: "schedule", activePlanId: "first",
        plans: [{ id: "first", name: "בדיקה", courses: { "2026a": (multiple ? ["01234567", "01674567"] : ["01234567"])
          .map(id => ({ id, groups: ["01"] })) } }] }))
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async items => {
        const blob = await items[0].getType("image/png")
        window.copiedImageSize = blob.size
      } } })
    }, width === 390)
    await page.goto(origin)
    await page.locator("#course-01234567").waitFor()
    await choose(page, "יצירת טופס רישום ב-Word")
    await page.getByLabel("שם התלמיד/ה").fill("ישראל ישראלי")
    await page.getByLabel("מספר ת״ז").fill("012345678")
    const before = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))
    const requests = []
    const navigations = []
    page.on("request", request => { if (/\.(js|doc)(\?|$)/.test(request.url()) && request.url().startsWith(origin)) requests.push(request.url()) })
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations.push(frame.url()) })
    current = builds[1]
    assert.equal((await fetch(`${origin}${entryA}`)).status, 404, "A's bundle really is gone")
    await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")) })
    const data = await download(page, width === 390 ? "הורדת טפסי Word (ZIP)" : "הורדת הטופס המקורי (DOC)")
    if (width === 390) {
      const zip = await JSZip.loadAsync(data)
      const docs = Object.values(zip.files).filter(file => !file.dir)
      assert.equal(docs.length, 2)
      for (const doc of docs) verifyDoc(await doc.async("nodebuffer"))
    } else verifyDoc(data)
    assert.equal(await page.getByLabel("שם התלמיד/ה").inputValue(), "ישראל ישראלי")
    assert.equal(await page.getByLabel("מספר ת״ז").inputValue(), "012345678")
    await page.keyboard.press("Escape")
    await choose(page, "ייצוא ל־PDF או לתמונה")
    const png = await download(page, "שמירת תמונה (PNG)")
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
    await page.getByRole("button", { name: "העתקת תמונה", exact: true }).click()
    await page.waitForFunction(() => window.copiedImageSize > 1000)
    assert.deepEqual(requests, [], "exports never request old JS or the template from the server")
    assert.deepEqual(navigations, [], "the existing page never reloads")
    assert.deepEqual(errors, [])
    assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), before,
      "exports do not persist form details or change the workspace")
    await context.close()
    console.log(`PASS ${width}px: ${width === 390 ? "ZIP" : "DOC"}, PNG and clipboard export after deployment; no reload, late asset requests or form persistence`)
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  await rm(output, { recursive: true, force: true })
}
