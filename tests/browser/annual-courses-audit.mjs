import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { createServer } from "vite"

const catalogs = JSON.parse(await readFile(new URL("../fixtures/annual-catalogs-2026.json", import.meta.url)))
const course = { id: "10313103", groups: ["01"] }
const server = process.env.DIBIT_TEST_URL ? undefined : await createServer({ server: { host: "127.0.0.1", port: 0 } })
let browser
let failures = 0
try {
  await server?.listen()
  browser = await chromium.launch()
  for (const scenario of ["delayed deselection", "delayed removal", "failed catalog", "plan switch", "saved schedule", "offline reload", "restore while pending", "switch while pending", "retry failed catalog"]) {
    const context = await browser.newContext()
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    let release
    const delayed = new Promise(resolve => { release = resolve })
    let completed
    let recovered = false
    const loaded = new Promise(resolve => { completed = resolve })
    await page.route("https://arazim-project.com/data/**", async route => {
      const filename = new URL(route.request().url()).pathname.split("/").pop()
      if (filename === "courses-2026b.json") {
        if (scenario.startsWith("delayed") || scenario.endsWith("while pending")) await delayed
        if (["failed catalog", "offline reload", "retry failed catalog"].includes(scenario) && !recovered) { await route.abort(); completed(); return }
      }
      await route.fulfill({ json: filename === "info.json" ? {
        currentSemester: "2026a", semesters: { "2026a": {}, "2026b": {} },
      } : catalogs[filename.slice(8, -5)] ?? {} })
      if (filename === "courses-2026b.json") completed()
    })
    const initial = {
      semester: "2026a", tab: "schedule", activePlanId: "first",
      plans: [
        { id: "first", name: "First", courses: { "2026a": [course], "2026b": scenario === "saved schedule" ? [] : [course] } },
        { id: "second", name: "Second", courses: { "2026b": [course] } },
      ],
    }
    await page.addInitScript(initial => {
      localStorage.setItem("Dib It Fork Intro Seen", "true")
      if (!localStorage.getItem("Dib It")) localStorage.setItem("Dib It", JSON.stringify(initial))
    }, initial)
    try {
      await page.goto(process.env.DIBIT_TEST_URL ?? `http://127.0.0.1:${server.httpServer.address().port}`)
      await page.locator("#course-10313103").getByRole("checkbox").waitFor()
      if (scenario === "delayed deselection") {
        await page.locator("#course-10313103").getByRole("checkbox").uncheck()
      } else if (["delayed removal", "offline reload", "restore while pending", "switch while pending"].includes(scenario)) {
        await page.locator("#course-10313103 .fa-trash").click()
      }
      if (scenario === "restore while pending") {
        await page.evaluate(async () => {
          const { setWorkspace } = await import("/src/models.ts")
          setWorkspace({ semester: "2026a", tab: "schedule", activePlanId: "first", plans: [{ id: "first", name: "Restored", courses: {} }] })
        })
      }
      if (scenario === "switch while pending") {
        await page.getByRole("button", { name: "פעולות", exact: true }).click()
        await page.getByRole("menuitem", { name: "מערכות שעות", exact: true }).click()
        await page.getByRole("textbox", { name: "מערכת שעות", exact: true }).click()
        await page.getByRole("option", { name: "Second", exact: true }).click()
      }
      if (scenario.startsWith("delayed")) {
        await page.getByRole("status").filter({ hasText: "הבחירות נשמרו" }).waitFor()
      }
      release()
      await loaded
      // Await response handlers and React's storage-event update, not just the HTTP response.
      await page.waitForTimeout(250)
      if (scenario === "offline reload") {
        recovered = true
        await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click()
        await page.waitForFunction(() => !JSON.parse(localStorage.getItem("Dib It")).plans[0].pendingAnnualChanges)
      }
      if (scenario === "retry failed catalog") {
        recovered = true
        await page.locator("#semester-selector").click()
        await page.getByRole("option").nth(1).click()
        await page.locator("#course-10313103").getByRole("checkbox").waitFor()
      }
      if (scenario === "switch while pending") {
        const first = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0])
        assert.equal(first.pendingAnnualChanges.length, 1, "inactive plan's pending edit was lost")
        await page.getByRole("button", { name: "פעולות", exact: true }).click()
        await page.getByRole("menuitem", { name: "מערכות שעות", exact: true }).click()
        await page.getByRole("textbox", { name: "מערכת שעות", exact: true }).click()
        await page.getByRole("option", { name: "First", exact: true }).click()
      }
      if (scenario === "plan switch") {
        await page.getByRole("button", { name: "פעולות", exact: true }).click()
        await page.getByRole("menuitem", { name: "מערכות שעות", exact: true }).click()
        await page.getByRole("textbox", { name: "מערכת שעות", exact: true }).click()
        await page.getByRole("option", { name: "Second", exact: true }).click()
      }
      const actual = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")))
      const active = actual.plans.find(plan => plan.id === actual.activePlanId)
      if (scenario === "delayed deselection") {
        assert.deepEqual(active.courses["2026a"][0].groups, [], "deselected group was selected again after catalog arrival")
        assert.deepEqual(active.courses["2026b"][0].groups, [])
      } else if (["delayed removal", "offline reload", "switch while pending"].includes(scenario)) {
        assert.deepEqual(active.courses["2026a"], [], "removed course was restored after catalog arrival")
        assert.deepEqual(active.courses["2026b"], [])
      } else if (scenario === "plan switch") {
        assert.deepEqual(active.courses["2026a"], [course], "switching to an existing plan did not reconcile its annual course")
      } else if (["failed catalog", "retry failed catalog"].includes(scenario)) {
        assert.deepEqual(actual.plans, initial.plans, "network failure changed stored schedules")
      } else if (scenario === "restore while pending") {
        assert.deepEqual(active.courses, {}, "pre-restore pending operation leaked into restored data")
        assert.equal(actual.plans.length, 1)
      } else {
        assert.deepEqual(active.courses["2026b"], [course])
        assert.deepEqual(actual.plans[1], initial.plans[1], "inactive plan changed")
      }
      assert.deepEqual(errors, [])
      console.log(`PASS ${scenario}`)
    } catch (error) {
      failures++
      console.error(`FAIL ${scenario}: ${error.message}`)
    } finally {
      release()
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server?.close()
}
process.exitCode = failures ? 1 : 0
