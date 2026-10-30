import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"
import { prepareAnnualFeed } from "./annual-fixture.mjs"

const server = await createServer({
  plugins: [{
    name: "capture-plan-bound-updater",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/models.ts")) return
      const boundary = "return [view, update] as const"
      assert.ok(code.includes(boundary), "regression must capture the actual hook updater")
      return code.replace(boundary, `globalThis.__planUpdaters ??= {};
        globalThis.__planUpdaters[workspace.activePlanId] = update;
        ${boundary}`)
    },
  }],
  define: { "import.meta.env.VITE_ENABLE_GOOGLE_SYNC": '"false"' },
  server: { host: "127.0.0.1", port: 0 },
})
const ids = ["11111111", "22222222", "33333333"]
const catalog = Object.fromEntries(ids.map((id, index) => [id, {
  name: `קורס ${index + 1}`,
  groups: ["01", "02"].map(group => ({ group, lessons: [{ day: "א", time: "08:00-10:00", type: "שיעור" }] })),
}]))
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", route => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
    const filename = url.pathname.split("/").pop()
    return route.fulfill({ json: filename === "info.json"
      ? { currentSemester: "2026a", semesters: { "2026a": {}, "2026b": {} } }
      : filename.startsWith("courses-") ? catalog : {} })
  })
  await prepareAnnualFeed(page)
  await page.addInitScript(ids => {
    localStorage.setItem("Dib It Fork Intro Seen", "true")
    localStorage.setItem("Dib It", JSON.stringify({ semester: "2026a", tab: "schedule", courses: {
      "2026a": ids.slice(0, 2).map(id => ({ id, groups: ["01"] })),
    } }))
  }, ids)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await page.locator(`#course-${ids[0]} input[type=checkbox]`).first().waitFor()
  await page.evaluate(async () => {
    const { getWorkspace, setWorkspace } = await import("/src/models.ts")
    await setWorkspace(getWorkspace())
  })
  const read = () => page.evaluate(async () => { await (await import("/src/workspaceStore.ts")).captureWorkspace(); return (await import("/src/models.ts")).getDibIt() })

  // An external write is intentionally delivered before React receives its storage event.
  // The already-rendered handler must read that latest data itself.
  await page.evaluate(ids => {
    const workspace = JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace
    workspace.plans[0].courses["2026a"].push({ id: ids[2], groups: ["02"] })
    workspace.theme = "google"
    localStorage.setItem("Dib It Workspace v2", JSON.stringify({ ...JSON.parse(localStorage.getItem("Dib It Workspace v2")), workspace, version: crypto.randomUUID() }))
    ;[...document.querySelectorAll("button")].find(button => button.textContent === "הגדרות").click()
  }, ids)
  assert.equal((await read()).tab, "settings")
  assert.equal((await read()).theme, "google")
  assert.deepEqual((await read()).courses["2026a"].map(course => course.id), ids)
  await page.getByRole("button", { name: "מערכת", exact: true }).click()

  await page.evaluate(id => {
    const workspace = JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace
    workspace.plans[0].courses["2026a"].find(course => course.id === id).groups.push("02")
    workspace.practicedExams = { [id]: ["2025aa"] }
    localStorage.setItem("Dib It Workspace v2", JSON.stringify({ ...JSON.parse(localStorage.getItem("Dib It Workspace v2")), workspace, version: crypto.randomUUID() }))
    document.querySelector(`#course-${id} input[type=checkbox]`).click()
  }, ids[0])
  assert.deepEqual((await read()).courses["2026a"][0].groups, ["02"])
  assert.deepEqual((await read()).practicedExams[ids[0]], ["2025aa"])

  // A stale card index must not reorder or remove the course now occupying that index.
  await page.evaluate(ids => {
    const workspace = JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace
    const courses = workspace.plans[0].courses["2026a"]
    workspace.plans[0].courses["2026a"] = [courses[2], courses[0], courses[1]]
    localStorage.setItem("Dib It Workspace v2", JSON.stringify({ ...JSON.parse(localStorage.getItem("Dib It Workspace v2")), workspace, version: crypto.randomUUID() }))
    document.querySelector(`#course-${ids[1]} [aria-label="הזזת הקורס למעלה"]`).click()
  }, ids)
  assert.deepEqual((await read()).courses["2026a"].map(course => course.id), [ids[2], ids[1], ids[0]])

  // A control belongs to its rendered semester even when persistence has navigated away.
  await page.evaluate(id => {
    const workspace = JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace
    workspace.semester = "2026b"
    workspace.plans[0].courses["2026b"] = [{ id, groups: ["01"] }]
    localStorage.setItem("Dib It Workspace v2", JSON.stringify({ ...JSON.parse(localStorage.getItem("Dib It Workspace v2")), workspace, version: crypto.randomUUID() }))
    document.querySelector(`#course-${id} [aria-label="הסרת הקורס"]`).click()
  }, ids[0])
  assert.equal((await read()).semester, "2026b")
  assert.equal((await read()).courses["2026a"].some(course => course.id === ids[0]), false)
  assert.deepEqual((await read()).courses["2026b"], [{ id: ids[0], groups: ["01"] }])
  await page.locator(`#course-${ids[0]} input[type=checkbox]`).first().waitFor()

  // Editing a stale card never resurrects a course deleted by another writer.
  await page.evaluate(id => {
    const workspace = JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace
    workspace.plans[0].courses["2026b"] = []
    localStorage.setItem("Dib It Workspace v2", JSON.stringify({ ...JSON.parse(localStorage.getItem("Dib It Workspace v2")), workspace, version: crypto.randomUUID() }))
    document.querySelector(`#course-${id} input[type=checkbox]`).click()
  }, ids[0])
  assert.deepEqual((await read()).courses["2026b"], [])

  // Annual intent belongs to the rendered course's semester, even after navigation.
  for (const semester of ["2026b", "2027a"]) for (const remove of [false, true]) {
    await page.evaluate(async id => {
      const { getWorkspace, setWorkspace } = await import("/src/models.ts")
      const workspace = getWorkspace()
      const annual = { id, groups: ["01"] }
      await setWorkspace({ ...workspace, semester: "2026a", customCourses: {
        "annual.json": { [id]: { name: "Annual course", groups: [{ group: "01", lessons: [{ type: "שנתי" }] }] } },
      }, plans: workspace.plans.map(plan => plan.id === workspace.activePlanId ? { ...plan,
        courses: { "2026a": [annual], "2026b": [annual] },
      } : plan) })
    }, ids[0])
    await page.locator(`#course-${ids[0]} input[type=checkbox]`).first().waitFor()
    await page.evaluate(({ id, semester, remove }) => {
      const workspace = JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace
      workspace.semester = semester
      workspace.theme = "apple"
      localStorage.setItem("Dib It Workspace v2", JSON.stringify({ ...JSON.parse(localStorage.getItem("Dib It Workspace v2")), workspace, version: crypto.randomUUID() }))
      document.querySelector(remove ? `#course-${id} [aria-label="הסרת הקורס"]` : `#course-${id} input[type=checkbox]`).click()
    }, { id: ids[0], semester, remove })
    const latest = await read()
    assert.equal(latest.semester, semester)
    assert.equal(latest.theme, "apple")
    for (const source of ["2026a", "2026b"]) assert.deepEqual(latest.courses[source], remove ? [] : [{ id: ids[0], groups: [] }],
      `late annual ${remove ? "removal" : "deselection"} updates ${source} while navigation stays ${semester}`)
  }

  // Accepted backups can carry a plan-level semester that overrides shared navigation.
  for (const remove of [false, true]) {
    await page.evaluate(async id => {
      const { getWorkspace, setWorkspace } = await import("/src/models.ts")
      const { storedWorkspaceSchema } = await import("/src/schemas.ts")
      const workspace = getWorkspace()
      const annual = { id, groups: ["01"] }
      setWorkspace(storedWorkspaceSchema.parse({ ...workspace, semester: "2026b", plans: workspace.plans.map(plan =>
        plan.id === workspace.activePlanId ? { ...plan, semester: "2026a",
          courses: { "2026a": [annual], "2026b": [annual] },
        } : plan),
      }))
    }, ids[0])
    await page.waitForFunction(id => document.querySelector(`#course-${id} input[type=checkbox]`)?.checked, ids[0])
    assert.equal((await read()).semester, "2026a", "the accepted active plan controls the rendered semester")
    await page.locator(remove ? `#course-${ids[0]} [aria-label="הסרת הקורס"]` : `#course-${ids[0]} input[type=checkbox]`).first().click()
    const latest = await read()
    for (const semester of ["2026a", "2026b"]) assert.deepEqual(latest.courses[semester], remove ? [] : [{ id: ids[0], groups: [] }],
      `annual ${remove ? "removal" : "deselection"} follows the rendered semester from an accepted backup`)
  }

  const guard = await page.evaluate(async () => {
    const { getWorkspace, setWorkspace, getDibIt } = await import("/src/models.ts")
    const { addPlan } = await import("/src/plans.ts")
    const previous = getWorkspace().activePlanId
    const oldCallback = globalThis.__planUpdaters[previous]
    await setWorkspace(addPlan(getWorkspace(), "Another plan"))
    const before = JSON.stringify(getWorkspace())
    await oldCallback(current => ({ ...current, theme: "apple", courses: {} }))
    return { unchanged: JSON.stringify(getWorkspace()) === before, active: getDibIt().activePlanId, previous }
  })
  assert.equal(guard.unchanged, true, "hook callbacks captured before a plan switch must be rejected")
  assert.notEqual(guard.active, guard.previous)
  assert.deepEqual(errors, [])
  console.log("PASS atomic edits: stale controls preserve newer data, annual semester intent and plan ownership")
} finally {
  await browser?.close()
  await server.close()
}
