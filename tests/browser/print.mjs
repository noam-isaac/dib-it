import assert from "node:assert/strict"
import { mkdir, readFile } from "node:fs/promises"
import { chromium, firefox, webkit } from "playwright"

const engine = process.env.DIBIT_BROWSER ?? "chromium"
const browserType = { chromium, firefox, webkit }[engine]
assert.ok(browserType, "Unsupported browser engine")
import { createServer } from "vite"

const output = "/tmp/dibit-pdf-review"
await mkdir(output, { recursive: true })
const server = await createServer({
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  cacheDir: "node_modules/.vite-print-test",
  server: { host: "127.0.0.1", port: 0 },
})
const catalog = Object.fromEntries([
  ["11111111", "חשבון דיפרנציאלי ואינטגרלי", "08:00-10:00", "א"],
  ["22222222", "מבוא למדעי המחשב", "18:00-20:00", "ה"],
  ["33333333", "סמינר בין־תחומי: מדע, חברה וטכנולוגיה", "12:00-14:00", "ו"],
  ["44444444", "אלגברה ליניארית", "10:00-12:00", "ב"],
  ["55555555", "מבוא ללוגיקה ולתורת הקבוצות", "12:00-14:00", "ג"],
  ["66666666", "יסודות ההסתברות", "10:00-12:00", "ד"],
].map(([id, name, time, day]) => [id, {
  name, groups: [{ group: "01", lecturer: "מרצה לבדיקה", lessons: [{ day, time, type: "שיעור", building: "בניין", room: "101" }] }],
  exams: [{ date: "15/02/2026", type: "בחינה סופית", moed: "א" }],
}]))
let browser
try {
  await server.listen()
  browser = await browserType.launch()
  for (const [width, colorScheme, theme] of [[1280, "light", "apple"], [390, "dark", "apple"], [390, "light", "google"], [1280, "dark", "google"]]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("**/*", route => {
      const url = new URL(route.request().url())
      if (url.hostname === "127.0.0.1") return route.continue()
      return route.fulfill({ json: url.pathname.endsWith("info.json")
        ? { currentSemester: "2026a", semesters: { "2026a": {} } }
        : url.pathname.includes("courses-") ? catalog : {} })
    })
    await page.addInitScript(({ theme, compact, ids }) => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      localStorage.setItem("Compact View", JSON.stringify(compact))
      localStorage.setItem("Dib It", JSON.stringify({ semester: "2026a", tab: "schedule", theme,
        courses: { "2026a": ids.map(id => ({ id, groups: ["01"] })) } }))
      window.printEvents = 0
      addEventListener("beforeprint", () => window.printEvents++)
    }, { theme, compact: width === 390, ids: Object.keys(catalog) })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
    await page.locator("#schedule-container").getByText(`${catalog["22222222"].name} (שיעור)`, { exact: true }).waitFor()
    const assertTimeOnRight = async () => {
      const schedule = page.locator("#schedule-container")
      const time = await schedule.getByText("8:00", { exact: true }).boundingBox()
      const sunday = await schedule.getByText("ראשון", { exact: true }).boundingBox()
      const friday = await schedule.getByText("שישי", { exact: true }).boundingBox()
      assert.ok(time.x > sunday.x + sunday.width && sunday.x > friday.x, "hours are right of Sunday; day order stays RTL")
      for (const [id, day] of [["11111111", "ראשון"], ["22222222", "חמישי"], ["33333333", "שישי"]]) {
        const label = await schedule.getByText(day, { exact: true }).boundingBox()
        const lesson = await schedule.getByText(`${catalog[id].name} (שיעור)`, { exact: true }).boundingBox()
        assert.ok(lesson.x >= label.x && lesson.x < label.x + label.width, "lessons remain under the correct day")
      }
    }
    await assertTimeOnRight()
    const screenWidth = await page.locator("#schedule-container").evaluate(el => el.clientWidth)
    const screenHeight = await page.locator("#schedule-container").evaluate(el => el.clientHeight)
    if (theme === "apple") {
      const before = await page.evaluate(() => localStorage.getItem("Dib It"))
      await page.getByRole("button", { name: "פעולות", exact: true }).click()
      const downloading = page.waitForEvent("download")
      await page.getByRole("menuitem", { name: "שמירת מערכת השעות כתמונה (PNG)", exact: true }).click()
      const download = await downloading
      assert.equal(download.suggestedFilename(), "dibit-2026a.png")
      const filename = `${output}/${engine}-schedule${width === 390 ? "-mobile" : ""}.png`
      await download.saveAs(filename)
      const png = await readFile(filename)
      assert.equal(png.readUInt32BE(16), screenWidth * 2, "PNG captures the displayed timetable at twice its resolution")
      assert.equal(png.readUInt32BE(20), screenHeight * 2, "PNG includes the full timetable height")
      assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before, "export never changes the workspace")
      const colors = await page.evaluate(async data => {
        const image = new Image()
        image.src = data
        await image.decode()
        const canvas = document.createElement("canvas")
        canvas.width = 112; canvas.height = 80
        const context = canvas.getContext("2d")
        context.drawImage(image, 0, 0, 112, 80)
        return new Set(context.getImageData(0, 0, 112, 80).data).size
      }, `data:image/png;base64,${png.toString("base64")}`)
      assert.ok(colors > 20, "PNG contains rendered content, not a blank page")
      if (engine === "chromium") {
        await page.evaluate(() => {
          window.originalToBlob = HTMLCanvasElement.prototype.toBlob
          HTMLCanvasElement.prototype.toBlob = callback => callback(null)
        })
        await page.getByRole("button", { name: "פעולות", exact: true }).click()
        await page.getByRole("menuitem", { name: "שמירת מערכת השעות כתמונה (PNG)", exact: true }).click()
        await page.getByText("שמירת התמונה נכשלה", { exact: true }).waitFor()
        await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob })
        await page.getByRole("button", { name: "פעולות", exact: true }).click()
        assert.equal(await page.getByRole("menuitem", { name: "שמירת מערכת השעות כתמונה (PNG)", exact: true }).isEnabled(), true)
        await page.keyboard.press("Escape")
      }
    }
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    if (engine === "chromium") {
      await page.getByRole("menuitem", { name: /הדפסה\/שמירה כ-PDF/ }).click()
      assert.equal(await page.evaluate(() => window.printEvents), 1, "menu must invoke native printing")
    }
    // Firefox's native print dialog blocks headless automation. Check its print CSS with the menu open.
    await page.emulateMedia({ media: "print" })
    assert.equal(await page.locator(".mantine-Menu-dropdown:visible").count(), 0)
    assert.equal(await page.locator(".mantine-Tooltip-tooltip:visible").count(), 0)
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light")
    for (const selector of ["#main", "#content", ".schedule"]) {
      assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).overflow), "visible")
    }
    await assertTimeOnRight()
    const grid = page.locator("#schedule-container")
    assert.equal(await grid.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, "all six columns fit")
    assert.equal(await grid.isVisible(), true, "print reuses the displayed timetable")
    if (engine === "chromium") {
    const pdf = await page.pdf({ path: `${output}/${theme}-${width}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true })
    assert.equal((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length, 1, "08:00-20:00 fits one page")
    } else {
      await page.screenshot({ path: `${output}/${engine}-${theme}-${width}-print.png`, fullPage: true })
    }
    await page.emulateMedia({ media: "screen" })
    assert.equal(await page.locator("#schedule-container").evaluate(el => el.clientHeight), screenHeight, "printing preserves screen density")
    if (theme === "apple" && engine === "chromium") {
      await page.getByRole("button", { name: "מבחנים", exact: true }).click()
      await page.emulateMedia({ media: "print" })
      await page.pdf({ path: `${output}/exams-${width}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true })
      await page.emulateMedia({ media: "screen" })
      await page.getByRole("button", { name: "מדריך", exact: true }).click()
      await page.emulateMedia({ media: "print" })
      const guide = await page.pdf({ path: `${output}/guide-${width}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true })
      assert.ok((guide.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length > 1, "long content is not clipped to the viewport")
    }
    assert.deepEqual(errors, [])
    console.log(`PASS print ${engine} ${width}px ${colorScheme}/${theme}: menu, no overlays, light paper, six columns, preserved screen view${engine === "chromium" ? ", one PDF page" : ""}`)
    await page.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
