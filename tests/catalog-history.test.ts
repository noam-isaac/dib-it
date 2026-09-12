import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { importSemesterCourses, selectedCatalogConflicts } from "../src/catalog"
import { sumHours } from "../src/utilities"
import { createCalendar } from "../src/serialize"
import { getRegistrationRows } from "../src/registration"
import { activePlanView, normalizePlans, updateActivePlan, reconcileActivePlan, addPlan } from "../src/plans"
import { annualGroupIds } from "../src/annualCourses"
import { isScheduleBackup } from "../src/scheduleBackup"
import { importCatalogs } from "./catalog-fixtures"
import history from "./fixtures/catalog-history.json"

const semesters = Object.keys(history.catalogs) as (keyof typeof history.catalogs)[]
const catalogs = importCatalogs(history.catalogs)
const selected = [{ id: "21721600", groups: ["01"] }]

test.each(semesters)("real catalog %s: identities, expected hours, registration and calendar", semester => {
  const source = history.catalogs[semester]
  const before = structuredClone(source)
  const catalog = catalogs[semester]
  history.cases[semester].forEach(({ id, group, status, hours }) => {
    const entry = catalog[id]!.groups.get(group)!
    const courses = [{ id, groups: [group, group] }]
    expect(entry.status).toBe(status)
    expect(sumHours(catalog, { semester, courses: { [semester]: courses } })).toBe(hours ?? 0)
    if (status === "conflict") {
      expect(() => getRegistrationRows(courses, catalog)).toThrow("סותרים")
      expect(() => createCalendar(semester, courses, catalog, { startDate: "2026-10-18", endDate: "2026-10-24" })).toThrow("סותרים")
    } else {
      expect(getRegistrationRows(courses, catalog)).toHaveLength(1)
      if (hours! > 0) {
        const ics = createCalendar(semester, courses, catalog, { startDate: "2026-10-18", endDate: "2026-10-24" })
        expect(ics).toContain(`UID:${semester}-${id}-${group}-`)
      }
    }
  })
  expect(source).toEqual(before)
  // Repeating complete source records must not alter the resolved model or conflicts.
  const repeated = importSemesterCourses(semester, Object.fromEntries(Object.entries(source).map(([id, c]) =>
    [id, { ...c, groups: [...c.groups, ...c.groups] }],
  )))
  expect(Object.entries(repeated).map(([id, c]) => [id, [...c!.groups.values()].map(g => [g.group, g.status])]))
    .toEqual(Object.entries(catalog).map(([id, c]) => [id, [...c!.groups.values()].map(g => [g.group, g.status])]))
})

test.each(semesters)("annual French %s: delayed catalogs, year/plan isolation, reload and removal", semester => {
  const other = semester.slice(0, 4) + (semester.endsWith("a") ? "b" : "a")
  expect(annualGroupIds({}, semester, "21721600")).toContain("01")
  const before = addPlan(normalizePlans({ semester, courses: { "2022a": selected } }), "Second")
  const view = { ...activePlanView(before), courses: { [semester]: selected } }
  const waiting = updateActivePlan(before, view, { [semester]: catalogs[semester] })
  expect(waiting.plans[1].pendingAnnualChanges).toHaveLength(1)
  expect(waiting.plans[0]).toEqual(before.plans[0])
  const loaded = reconcileActivePlan(structuredClone(waiting), catalogs)
  expect(loaded.plans[1].courses).toEqual({ [semester]: selected, [other]: selected })
  expect(loaded.plans[1].pendingAnnualChanges).toBeUndefined()
  expect(sumHours(catalogs[semester], activePlanView(loaded))).toBe(4)
  expect(sumHours(catalogs[other], { ...activePlanView(loaded), semester: other })).toBe(4)
  const pendingRemoval = updateActivePlan(loaded, { ...activePlanView(loaded), courses: { [semester]: [], [other]: selected } }, {})
  expect(pendingRemoval.plans[1].pendingAnnualChanges).toHaveLength(1)
  expect(isScheduleBackup(pendingRemoval)).toBe(true)
  const restored = JSON.parse(JSON.stringify(pendingRemoval))
  expect(reconcileActivePlan(restored, catalogs).plans[1].courses).toEqual({ [semester]: [], [other]: [] })
  expect(reconcileActivePlan(restored, catalogs).plans[0]).toEqual(before.plans[0])
})

test("catalog conflicts never erase selections, and corrected source records become usable on reimport", () => {
  const semester = "2027a"
  const raw = history.catalogs[semester]["21721600"]
  const original = raw.groups[0]
  const conflicts = importSemesterCourses(semester, { "21721600": { ...raw,
    groups: [original, { ...original, lecturer: "Conflicting lecturer" }],
  } })
  const workspace = normalizePlans({ semester, courses: { "2027a": selected, "2027b": selected } })
  const preserved = reconcileActivePlan(workspace, { "2027a": conflicts, "2027b": catalogs["2027b"] })
  expect(preserved).toEqual(workspace)
  expect(selectedCatalogConflicts(selected, conflicts)).toEqual(["21721600/01"])
  expect(selectedCatalogConflicts(selected, catalogs[semester])).toEqual([])
  expect(sumHours(catalogs[semester], activePlanView(preserved))).toBe(4)
})

// Optional full-feed audit: download the ten URLs in the fixture's audit section,
// then DIBIT_CATALOG_DIR=/path/to/catalogs bun test tests/catalog-history.test.ts.
const directory = process.env.DIBIT_CATALOG_DIR
if (directory) test.each(semesters)("full feed %s: source fingerprint and every group identity", semester => {
  const bytes = readFileSync(`${directory}/courses-${semester}.json`)
  const expected = history.audit[semester]
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256)
  const source: SemesterCourses = JSON.parse(bytes.toString())
  const before = structuredClone(source)
  const catalog = importSemesterCourses(semester, source)
  expect(Object.keys(catalog)).toHaveLength(expected.courses)
  expect(Object.values(catalog).reduce((n, c) => n + c!.groups.size, 0)).toBe(expected.groups)
  const conflicts = Object.entries(catalog).flatMap(([id, c]) => [...c!.groups.values()]
    .filter(g => g.status === "conflict").map(g => `${id}/${g.group}`))
  expect(conflicts).toEqual(expected.conflicts)
  Object.entries(catalog).forEach(([id, c]) => c!.groups.forEach(group => {
    const records = source[id]!.groups!.filter(r => r.group === group.group)
    if (group.status === "ready") expect(records).toContain(group.data)
    else expect(group.records).toEqual(records)
    expect(c!.semester).toBe(semester)
  }))
  expect(source).toEqual(before)
})

test("custom catalog conflicts preserve raw backups and annual selection intent", () => {
  const source = { local: { name: "Local annual", groups: [
    { group: "01", lessons: [{ day: "א", time: "10:00-12:00", type: "שנתי" }] },
    { group: "01", lessons: [{ day: "א", time: "12:00-14:00", type: "שנתי" }] },
  ] } }
  const customCourses = { "custom.json": source }
  const before = normalizePlans({ semester: "2027a", customCourses })
  const courses = [{ id: "local", groups: ["01"] }]
  const saved = updateActivePlan(before, { ...activePlanView(before), courses: { "2027a": courses } })
  expect(saved.plans[0].courses).toEqual({ "2027a": courses, "2027b": courses })
  expect(saved.customCourses).toEqual(customCourses)
  expect(selectedCatalogConflicts(courses, importSemesterCourses("2027a", source))).toEqual(["local/01"])
  const restored = JSON.parse(JSON.stringify(saved))
  expect(isScheduleBackup(restored)).toBe(true)
  expect(restored.customCourses).toEqual(customCourses)
  const removed = updateActivePlan(restored, { ...activePlanView(restored), courses: { "2027a": [], "2027b": courses } })
  expect(removed.plans[0].courses).toEqual({ "2027a": [], "2027b": [] })
})
