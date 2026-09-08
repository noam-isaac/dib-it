import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
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
  ["11111111", "EARLY CLASS", "08:00-10:00", "א"],
  ["22222222", "LATE CLASS", "18:00-20:00", "ה"],
  ["33333333", "FRIDAY CLASS", "12:00-14:00", "ו"],
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
    await page.locator("#schedule-container").getByText("LATE CLASS (שיעור)", { exact: true }).waitFor()
    const screenHeight = await page.locator("#schedule-container").evaluate(el => el.clientHeight)
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
    const grid = page.locator("#schedule-container")
    assert.equal(await grid.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, "all six columns fit")
    if (engine === "chromium") {
    const pdf = await page.pdf({ path: `${output}/${theme}-${width}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true })
    assert.equal((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length, 1, "08:00-20:00 fits one page")
    } else {
      await page.screenshot({ path: `${output}/${engine}-${theme}-${width}-print.png`, fullPage: true })
    }
    await page.emulateMedia({ media: "screen" })
    assert.equal(await grid.evaluate(el => el.clientHeight), screenHeight, "printing preserves screen density")
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
