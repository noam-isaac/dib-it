import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium, firefox, webkit } from "playwright"
import { createServer } from "vite"

const history = JSON.parse(await readFile(new URL("../fixtures/catalog-history.json", import.meta.url)))
const scenarios = Object.entries(history.audit).flatMap(([semester, data]) => data.conflicts.map(identity => ({ semester, identity })))
const engine = process.env.DIBIT_BROWSER ?? "chromium"
const server = await createServer({ define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  cacheDir: `node_modules/.vite-test-catalog-conflicts-${engine}`, server: { host: "127.0.0.1", port: 0 },
})
let browser
try {
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await ({ chromium, firefox, webkit })[engine].launch()
  for (const { semester, identity } of scenarios) {
    const [id, group] = identity.split("/")
    const source = history.catalogs[semester]
    const record = source[id].groups.find(row => row.group === group)
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    let corrected = false
    await page.route("**/*", route => new URL(route.request().url()).origin === url ? route.continue() : route.abort())
    await page.route("https://arazim-project.com/data/**", route => {
      const filename = new URL(route.request().url()).pathname.split("/").pop()
      const json = filename === "info.json" ? { currentSemester: semester, semesters: { [semester]: {} } }
        : filename === `courses-${semester}.json` ? { ...source,
          [id]: corrected ? { ...source[id], groups: [record] } : source[id],
        } : history.catalogs[filename.slice(8, -5)] ?? {}
      return route.fulfill({ json })
    })
    await page.addInitScript(({ semester, id, group }) => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify({ semester, tab: "schedule",
        courses: { [semester]: [{ id, groups: [group] }, { id: "21721600", groups: ["01"] }] },
      }))
    }, { semester, id, group })
    await page.goto(url)
    await page.getByText("שעות: 4 (חלקי)", { exact: true }).waitFor()
    await page.locator("#schedule-container").getByRole("alert").waitFor()
    if (process.env.DIBIT_SCREENSHOT_DIR && semester === "2027a") await page.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/catalog-conflict-${engine}.png`, fullPage: true })
    const card = page.locator(`#course-${id}`)
    assert.equal(await card.getByRole("checkbox", { name: new RegExp(`^קבוצה ${group}`) }).isChecked(), true)
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    for (const name of ["ייצוא ל-Apple/Google Calendar", "יצירת טופס רישום ב-Word", "ייצוא ל־PDF או לתמונה"]) {
      assert.equal(await page.getByRole("menuitem", { name, exact: true }).isDisabled(), true)
    }
    await page.keyboard.press("Escape")
    await page.reload()
    await page.getByText("שעות: 4 (חלקי)", { exact: true }).waitFor()
    assert.equal(await card.getByRole("checkbox", { name: new RegExp(`^קבוצה ${group}`) }).isChecked(), true)
    await card.getByRole("checkbox", { name: new RegExp(`^קבוצה ${group}`) }).uncheck()
    await page.getByText("שעות: 4", { exact: true }).waitFor()
    assert.equal(await card.getByRole("checkbox", { name: new RegExp(`^קבוצה ${group}`) }).isDisabled(), false)
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
    assert.equal(await page.getByRole("menuitem", { name: "ייצוא ל-Apple/Google Calendar", exact: true }).isDisabled(), false)
    await page.keyboard.press("Escape")
    // Selection stays under the user's control even while its timing is unresolved.
    await card.getByRole("checkbox", { name: new RegExp(`^קבוצה ${group}`) }).check()
    await page.getByText("שעות: 4 (חלקי)", { exact: true }).waitFor()
    // A corrected source restores the selected group's schedule without rewriting selections.
    const correctedHours = 4 + record.lessons.reduce((hours, lesson) => {
      if (!/^[א-ו]$/.test(lesson.day)) return hours
      const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(lesson.time)
      return match ? hours + (Number(match[3]) * 60 + Number(match[4]) - Number(match[1]) * 60 - Number(match[2])) / 60 : hours
    }, 0)
    const saved = await page.evaluate(() => localStorage.getItem("Dib It"))
    corrected = true
    await page.reload()
    await page.getByText(`שעות: ${correctedHours}`, { exact: true }).waitFor()
    assert.equal(await card.getByRole("checkbox", { name: new RegExp(`^קבוצה ${group}`) }).isDisabled(), false)
    assert.equal(await page.evaluate(() => localStorage.getItem("Dib It")), saved)
    assert.equal(await card.getByRole("checkbox", { name: new RegExp(`^קבוצה ${group}`) }).isChecked(), true)
    assert.equal(await card.getByText(/נתונים סותרים/).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`PASS ${engine} ${semester} ${identity}: conflict visible, exports blocked, selection preserved, deselection and corrected source`)
  }
} finally {
  await browser?.close()
  await server.close()
}
