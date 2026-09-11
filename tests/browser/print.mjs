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
  ["77777777", "Theory of Functions of a Complex Variable 1", "10:00-11:00", "ב"],
  ["88888888", "Syntax seminar: The interfaces of syntax", "10:00-11:00", "ב"],
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
    const screenHeight = await page.locator("#schedule-container").evaluate(el => el.clientHeight)
    const before = await page.evaluate(() => localStorage.getItem("Dib It"))
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    assert.equal(await page.getByRole("menuitem", { name: /PNG/ }).count(), 0, "no separate image menu item")
    await page.getByRole("menuitem", { name: "ייצוא ל־PDF או לתמונה", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "העתקת תמונה", exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.printEvents), 0, "format is chosen before printing")
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".mantine-Modal-content")).opacity === "1")
    assert.equal(await dialog.getByRole("button", { name: "העתקת תמונה", exact: true }).evaluate(button => {
      const rect = button.getBoundingClientRect()
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("button") === button
    }), true, "timetable tiles cannot cover the chooser")
    if (engine === "chromium" && width === 1280 && theme === "apple") await dialog.screenshot({ path: `${output}/export-chooser.png` })
    const downloads = []
    page.on("download", download => downloads.push(download))
    await page.evaluate(() => {
      window.originalToBlob = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (...args) {
        const copy = document.querySelectorAll("#schedule-container")[1]
        window.imageLayout = [...copy.querySelectorAll(':scope > div > div[style*="display: grid"] > div')].map(tile => ({
          text: tile.textContent, height: tile.clientHeight, contentHeight: tile.scrollHeight,
          width: tile.clientWidth, contentWidth: tile.scrollWidth,
        }))
        return window.originalToBlob.apply(this, args)
      }
      // Verify the Clipboard API boundary without replacing the user's system clipboard.
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async items => {
        window.copyStartedDuringClick = navigator.userActivation.isActive
        const blob = await items[0].getType("image/png")
        window.copiedImage = { type: blob.type, size: blob.size }
      } } })
    })
    await dialog.getByRole("button", { name: "העתקת תמונה", exact: true }).click()
    await dialog.getByText("התמונה הועתקה — אפשר להדביק אותה כעת.", { exact: true }).waitFor()
    assert.equal(downloads.length, 0, "copy does not download a file")
    assert.deepEqual(await page.evaluate(() => [window.copyStartedDuringClick, window.copiedImage.type, window.copiedImage.size > 1000]), [true, "image/png", true])
    const layout = await page.evaluate(() => window.imageLayout)
    assert.equal(layout.length, Object.keys(catalog).length)
    for (const tile of layout) {
      assert.ok(tile.contentHeight <= tile.height + 1 && tile.contentWidth <= tile.width + 1, `complete image tile: ${tile.text}`)
    }
    assert.equal(await page.locator("#schedule-container").count(), 1, "temporary DOM copy is removed")
    const downloading = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "שמירת תמונה (PNG)", exact: true }).click()
    const download = await downloading
    assert.equal(download.suggestedFilename(), "dibit-2026a.png")
    const filename = `${output}/${engine}-${theme}-${width}-image.png`
    await download.saveAs(filename)
    const png = await readFile(filename)
    assert.equal(png.readUInt32BE(16), 2800, "image is reflowed at readable width even on mobile")
    assert.ok(png.readUInt32BE(20) > 2400, "dense overlapping text expands the time grid")
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), before, "export never changes the workspace")
    if (engine === "chromium") {
      await page.evaluate(() => { navigator.clipboard.write = async () => { throw new DOMException("denied", "NotAllowedError") } })
      await dialog.getByRole("button", { name: "העתקת תמונה", exact: true }).click()
      await dialog.getByRole("alert").waitFor()
      assert.equal(downloads.length, 1, "clipboard denial never triggers an automatic download")
      await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = callback => callback(null) })
      await dialog.getByRole("button", { name: "שמירת תמונה (PNG)", exact: true }).click()
      await dialog.getByText("לא ניתן ליצור את התמונה. נסו שוב.", { exact: true }).waitFor()
      assert.equal(await page.locator("#schedule-container").count(), 1, "encoder failure removes its DOM copy")
      await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob })
      assert.equal(await dialog.getByRole("button", { name: "שמירת תמונה (PNG)", exact: true }).isEnabled(), true)
      await dialog.getByRole("button", { name: "הדפסה / PDF", exact: true }).click()
      assert.equal(await page.evaluate(() => window.printEvents), 1, "PDF choice invokes native printing")
    }
    // Firefox's native print dialog blocks headless automation. Check its print CSS with the chooser open.
    await page.emulateMedia({ media: "print" })
    assert.equal(await page.locator(".mantine-Modal-root:visible").count(), 0)
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
    await page.keyboard.press("Escape")
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
