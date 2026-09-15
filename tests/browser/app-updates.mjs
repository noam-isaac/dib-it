import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { build } from "vite"
import { chromium } from "playwright"

// Keep A running in the browser while the origin starts serving B's production files.
// No development server, account, live catalog, or real system clipboard is used.
const output = await mkdtemp(join(tmpdir(), "dibit-updates-"))
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
        : file.endsWith(".html") ? "text/html" : file.endsWith(".json") ? "application/json" : "application/octet-stream" })
    response.end(body)
  } catch { response.writeHead(404); response.end("NOT_FOUND") }
})
const catalog = { "01234567": { name: "קורס בדיקה", faculty: "פקולטה/חוג בדיקה",
  groups: [{ group: "01", lessons: [{ day: "א", time: "10:00-12:00", type: "שיעור" }] }], exams: [] } }
const initial = { semester: "2026a", tab: "schedule", activePlanId: "first",
  plans: [{ id: "first", name: "בדיקה", courses: { "2026a": [{ id: "01234567", groups: ["01"] }] } }] }
const notice = page => page.locator(".mantine-Notification-root").filter({ hasText: /גרסה חדשה זמינה|לא ניתן להשלים את הטעינה/ })
const choose = async (page, name) => {
  await page.getByRole("button", { name: "פעולות", exact: true }).click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}
const registration = async page => {
  await choose(page, "יצירת טופס רישום ב-Word")
  await page.getByLabel("שם התלמיד/ה").fill("ישראל ישראלי")
  await page.getByLabel("מספר ת״ז").fill("012345678")
}
const submit = page => page.getByRole("button", { name: "הורדת הטופס המקורי (DOC)", exact: true }).click()
const downloadWord = async page => {
  const downloading = page.waitForEvent("download")
  await submit(page)
  const file = await downloading
  assert.match(file.suggestedFilename(), /\.doc$/)
  const chunks = []
  for await (const chunk of await file.createReadStream()) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).length, 150528)
}
const returnToTab = page => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))

try {
  // Rename B's chunks even when a dependency's bytes happen to be unchanged.
  for (const outDir of builds) await build({ logLevel: "error", build: { outDir, emptyOutDir: true,
    rollupOptions: { output: { chunkFileNames: outDir === builds[0] ? "assets/[name]-[hash].js" : "assets/[name]-b-[hash].js" } } },
    define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' } })
  const versions = await Promise.all(builds.map(async dir => JSON.parse(await readFile(join(dir, "version.json"), "utf8")).version))
  assert.notEqual(versions[0], versions[1])
  const entryB = (await readFile(join(builds[1], "index.html"), "utf8")).match(/src="([^"]+\.js)"/)[1]
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch()
  const open = async (width = 1280) => {
    current = builds[0]
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.route("https://arazim-project.com/data/**", route => {
      const file = new URL(route.request().url()).pathname.split("/").pop()
      return route.fulfill({ json: file === "info.json" ? { currentSemester: "2026a", semesters: {
        "2026a": { startDate: "2025-10-26", endDate: "2026-01-25" } } } : file === "courses-2026a.json" ? catalog : {} })
    })
    await page.addInitScript(state => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify(state))
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async items => {
        const blob = await items[0].getType("image/png")
        window.copiedImageSize = blob.size
      } } })
    }, initial)
    await page.goto(origin)
    await page.locator("#course-01234567").waitFor()
    return page
  }
  const onB = async page => {
    try { await page.waitForFunction(entry => document.querySelector('script[type="module"]')?.getAttribute("src") === entry, entryB) }
    catch (error) {
      console.error(await page.evaluate(() => ({ notices: [...document.querySelectorAll(".mantine-Notification-root")].map(node => node.textContent),
        inputs: [...document.querySelectorAll("input")].map(node => ({ type: node.type, value: node.value, readonly: node.readOnly })),
        dialogs: document.querySelectorAll('[role="dialog"]').length, busy: document.querySelectorAll('[aria-busy="true"]').length })))
      throw error
    }
    await page.locator("#course-01234567").waitFor()
  }

  // Idle pages update without asking. Navigation and schedule data survive.
  {
    const page = await open()
    const before = await page.evaluate(() => localStorage.getItem("Dib It"))
    current = builds[1]
    await returnToTab(page)
    await onB(page)
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before)
    await page.context().close()
    console.log("PASS idle tab updates to B and preserves the workspace")
  }

  for (const trigger of ["visibility", "missing-module"]) {
    const page = await open(trigger === "visibility" ? 390 : 1280)
    await registration(page)
    const before = await page.evaluate(() => localStorage.getItem("Dib It"))
    current = builds[1]
    if (trigger === "visibility") await returnToTab(page)
    else await submit(page)
    await notice(page).waitFor()
    assert.equal(await page.getByLabel("שם התלמיד/ה").inputValue(), "ישראל ישראלי")
    assert.equal(await page.getByText("יצירת הטופס נכשלה", { exact: true }).count(), 0)
    if (trigger === "missing-module") {
      await submit(page)
      assert.equal(await notice(page).count(), 1)
    }
    await notice(page).getByRole("button", { name: "עדכון והמשך", exact: true }).click()
    await onB(page)
    await page.getByLabel("שם התלמיד/ה").waitFor()
    assert.equal(await page.getByLabel("שם התלמיד/ה").inputValue(), "ישראל ישראלי")
    assert.equal(await page.getByLabel("מספר ת״ז").inputValue(), "012345678")
    assert.equal(await page.evaluate(() => sessionStorage.getItem("Dib It Update Resume")), null)
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before)
    await downloadWord(page)
    await page.context().close()
    console.log(`PASS ${trigger}: one prompt, restored registration draft, valid DOC on B`)
  }

  for (const name of ["שמירת תמונה (PNG)", "העתקת תמונה"]) {
    const page = await open()
    await choose(page, "ייצוא ל־PDF או לתמונה")
    current = builds[1]
    await page.getByRole("button", { name, exact: true }).click()
    await notice(page).waitFor()
    await notice(page).getByRole("button", { name: "עדכון והמשך", exact: true }).click()
    await onB(page)
    const button = page.getByRole("button", { name, exact: true })
    if (name.includes("PNG")) {
      const downloading = page.waitForEvent("download")
      await button.click()
      assert.match((await downloading).suggestedFilename(), /\.png$/)
    } else {
      await button.click()
      await page.waitForFunction(() => window.copiedImageSize > 1000)
    }
    await page.context().close()
    console.log(`PASS ${name}: Vite recovery restores the image chooser and completes the export`)
  }

  // A template fetch is separate from Vite's module loader, including on the latest build.
  {
    const page = await open()
    await registration(page)
    await page.route("**/assets/registration-template-*.doc", route => route.fulfill({ status: 404, body: "missing" }))
    await submit(page)
    await notice(page).waitFor()
    const reloaded = page.waitForEvent("framenavigated", frame => frame === page.mainFrame())
    await notice(page).getByRole("button", { name: "בדיקה וניסיון נוסף", exact: true }).click()
    await reloaded
    await page.getByLabel("שם התלמיד/ה").waitFor()
    await page.waitForFunction(() => sessionStorage.getItem("Dib It Update Attempt") !== null)
    // Wait for restoration, not the old page's still-mounted form.
    await page.waitForFunction(() => sessionStorage.getItem("Dib It Update Resume") === null)
    await submit(page)
    await notice(page).waitFor()
    const navigations = []
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations.push(frame.url()) })
    await notice(page).getByRole("button", { name: "בדיקה וניסיון נוסף", exact: true }).click()
    await page.getByText(/הטעינה עדיין לא הצליחה אחרי הרענון/).waitFor()
    assert.equal(navigations.length, 0, "a persistent failure cannot reload repeatedly")
    await page.unroute("**/assets/registration-template-*.doc")
    await downloadWord(page)
    await page.context().close()
    console.log("PASS missing template: restored draft, bounded reload, retry succeeds when the file returns")
  }

  // Updating must not interrupt a download that is still preparing its file.
  {
    const page = await open()
    await registration(page)
    let releaseTemplate
    const paused = new Promise(resolve => { releaseTemplate = resolve })
    let templateRequested
    const requested = new Promise(resolve => { templateRequested = resolve })
    await page.route("**/assets/registration-template-*.doc", async route => {
      const body = await readFile(join(builds[0], new URL(route.request().url()).pathname))
      templateRequested()
      await paused
      await route.fulfill({ body, contentType: "application/msword" })
    })
    const downloading = page.waitForEvent("download")
    await submit(page)
    await requested
    current = builds[1]
    await returnToTab(page)
    await notice(page).getByRole("button", { name: "עדכון והמשך", exact: true }).click()
    await page.getByText(/העדכון ממתין לסיום הפעולה/).waitFor()
    assert.notEqual(await page.locator('script[type="module"]').getAttribute("src"), entryB)
    releaseTemplate()
    await downloading
    await notice(page).getByRole("button", { name: "עדכון והמשך", exact: true }).click()
    await onB(page)
    await page.getByLabel("שם התלמיד/ה").waitFor()
    assert.equal(await page.getByLabel("שם התלמיד/ה").inputValue(), "ישראל ישראלי")
    await page.context().close()
    console.log("PASS in-flight export: update waits until the download finishes")
  }

  // An unavailable version endpoint cannot justify discarding a working page.
  for (const fault of ["offline", "invalid-version", "storage-blocked", "other-dialog", "unfinished-search"]) {
    const page = await open()
    await registration(page)
    current = builds[1]
    if (fault === "offline") await page.route("**/version.json", route => route.abort())
    if (fault === "invalid-version") await page.route("**/version.json", route => route.fulfill({ json: { version: 42 } }))
    if (fault === "storage-blocked") await page.evaluate(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (this === sessionStorage) throw new DOMException("blocked", "SecurityError")
        return original.call(this, key, value)
      }
    })
    if (fault === "other-dialog") {
      await page.keyboard.press("Escape")
      await choose(page, "מערכות שעות")
    }
    if (fault === "unfinished-search") {
      await page.keyboard.press("Escape")
      await page.getByPlaceholder("חיפוש קורסים להוספה").fill("טיוטת חיפוש")
    }
    if (["offline", "invalid-version"].includes(fault)) await submit(page)
    else await returnToTab(page)
    await notice(page).waitFor()
    if (["storage-blocked", "other-dialog", "unfinished-search"].includes(fault)) {
      await notice(page).getByRole("button", { name: "עדכון והמשך", exact: true }).click()
      await page.getByText(fault === "storage-blocked" ? /העדכון ממתין לסיום הפעולה/ : /סיימו את העריכה או החיפוש/).waitFor()
    } else {
      await page.getByText(/בדקו את החיבור/).waitFor()
      await submit(page)
      assert.equal(await notice(page).count(), 1)
    }
    assert.notEqual(await page.locator('script[type="module"]').getAttribute("src"), entryB)
    if (!["other-dialog", "unfinished-search"].includes(fault)) assert.equal(await page.getByLabel("שם התלמיד/ה").inputValue(), "ישראל ישראלי")
    if (fault === "unfinished-search") assert.equal(await page.getByPlaceholder("חיפוש קורסים להוספה").inputValue(), "טיוטת חיפוש")
    await page.context().close()
    console.log(`PASS ${fault}: stays on the current page without discarding work`)
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  await rm(output, { recursive: true, force: true })
}
