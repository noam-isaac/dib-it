import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

// Issue #14: the export refused to run over values the dialog never asks the student for.
// A catalog course number that the printed boxes cannot hold must degrade, not fail.
const catalog = {
  "01234567": {
    name: "מבוא לבדיקות", faculty: "פקולטה לבדיקה/חוג בדיקה",
    groups: [{ group: "01", lessons: [{ day: "א", time: "10:00-12:00", type: "שיעור" }] }],
    exams: [],
  },
  1234: {
    name: "קורס בלי מספר תקני", faculty: "פקולטה לבדיקה/חוג בדיקה",
    groups: [{ group: "01", lessons: [{ day: "ב", time: "10:00-12:00", type: "שיעור" }] }],
    exams: [],
  },
}
const initial = {
  semester: "2026a", tab: "schedule", activePlanId: "first",
  plans: [{ id: "first", name: "בדיקה", courses: { "2026a": [
    { id: "01234567", groups: ["01"] }, { id: "1234", groups: ["01"] },
  ] } }],
}

const server = await createServer({ cacheDir: "node_modules/.vite-registration-form-test", server: { host: "127.0.0.1", port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("https://arazim-project.com/data/**", route => {
    const filename = new URL(route.request().url()).pathname.split("/").pop()
    return route.fulfill({ json: filename === "info.json"
      ? { currentSemester: "2026a", semesters: { "2026a": { startDate: "2025-10-26", endDate: "2026-01-25" } } }
      : filename === "courses-2026a.json" ? catalog : {} })
  })
  await page.addInitScript(state => {
    localStorage.setItem("Dib It Fork Intro Seen", "true")
    localStorage.setItem("Dib It", JSON.stringify(state))
  }, initial)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)

  await page.getByRole("button", { name: "פעולות", exact: true }).click()
  await page.getByRole("menuitem", { name: "יצירת טופס רישום ב-Word", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("טופס רישום לקורסים", { exact: true }).waitFor()

  const unusable = dialog.getByRole("row").filter({ hasText: "קורס בלי מספר תקני" })
  await unusable.getByText("לא בטופס", { exact: true }).waitFor()
  assert.equal(await dialog.getByRole("row").filter({ hasText: "מבוא לבדיקות" })
    .getByText("לא בטופס", { exact: true }).count(), 0, "usable rows must not be flagged")
  assert.match(await dialog.getByRole("alert").textContent(), /אינם מתאימים\s+למשבצות הטופס המקורי/)

  await dialog.getByLabel("שם התלמיד/ה").fill("ישראל ישראלי")
  await dialog.getByLabel("מספר ת״ז").fill("012345678")
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "הורדת הטופס המקורי (DOC)", exact: true }).click()
  assert.match((await download).suggestedFilename(), /^dibit-registration-2025-1\.doc$/)

  await page.getByText("הטופס מוכן", { exact: true }).waitFor()
  assert.equal(await page.getByText("יצירת הטופס נכשלה", { exact: true }).count(), 0,
    "a course number the student cannot edit must never fail the export")
  const notification = page.locator(".mantine-Notification-root").filter({ hasText: "הטופס מוכן" })
  assert.match(await notification.textContent(), /1234\/01/)

  // The fields the student does fill are still refused, at the field itself.
  const id = dialog.getByLabel("מספר ת״ז")
  await id.fill("12")
  await dialog.getByRole("button", { name: "הורדת הטופס המקורי (DOC)", exact: true }).click()
  assert.equal(await id.evaluate(input => input.validity.patternMismatch), true)
  assert.equal(await page.getByText("יצירת הטופס נכשלה", { exact: true }).count(), 0)

  assert.deepEqual(errors, [])
  console.log("PASS registration form: unusable course numbers are flagged, skipped and reported; student fields still validated")
} finally {
  await browser?.close()
  await server.close()
}
