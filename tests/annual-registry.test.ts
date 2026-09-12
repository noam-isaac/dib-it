import { importCatalogs } from "./catalog-fixtures"
import { expect, test } from "bun:test"
import { acceptAnnualFeed, annualYear, isAnnualFeed } from "../src/annualRegistry"
import { annualChanges, applyAnnualChanges } from "../src/annualCourses"
import { isScheduleBackup } from "../src/scheduleBackup"

const source = "https://www.ims.tau.ac.il/Tal/KR/Search_P.aspx"
const data = { source, filter: "ckSem=0", verifiedAt: "2026-09-09", groups: { "12345678": ["01"] } }

test("annual feed validates its boundary, preserves absent years and rejects rollback", () => {
  for (const bad of [null, {}, { version: 2, years: { "2098": data } }, { version: 1, years: {} },
    ...[{ groups: {} }, { groups: { "12345678": [1] } }, { source: "other" }, { verifiedAt: "2026-02-31" }]
      .map(change => ({ version: 1, years: { "2098": { ...data, ...change } } })),
  ]) expect(isAnnualFeed(bad)).toBe(false)
  const previous = annualYear("2026")
  acceptAnnualFeed({ version: 1, years: { "2098": data } })
  expect(annualYear("2026")).toEqual(previous)
  acceptAnnualFeed({ version: 1, years: { "2098": { ...data, verifiedAt: "2026-09-08", groups: { "87654321": ["02"] } } } })
  expect(annualYear("2098")).toEqual(data)
})

test("edits made before a year's classification survive until the feed arrives", () => {
  const course = { id: "12345678", groups: ["01"] }
  const before = { "2097a": [course], "2097b": [course] }
  const view = { semester: "2097a", courses: { ...before, "2097a": [] } }
  const changes = annualChanges(before, view)
  expect(changes[0].awaitingClassification).toBe(true)
  const catalogs = Object.fromEntries(["2097a", "2097b"].map(semester => [semester, { [course.id]: { groups: [{ group: "01" }] } }]))
  const waiting = applyAnnualChanges(view, changes, importCatalogs(catalogs))
  expect(waiting.pending).toEqual(changes)
  expect(waiting.courses).toEqual(view.courses)
  expect(isScheduleBackup({ plans: [{ id: "plan", name: "Plan", courses: view.courses, pendingAnnualChanges: changes }], activePlanId: "plan" })).toBe(true)
  acceptAnnualFeed({ version: 1, years: { "2097": data } })
  const resolved = applyAnnualChanges(view, waiting.pending, importCatalogs(catalogs))
  expect(resolved.pending).toEqual([])
  expect(resolved.courses).toEqual({ "2097a": [], "2097b": [] })
})

test("a deferred edit to a course confirmed nonannual never changes the other semester", () => {
  const before = { "2096a": [{ id: "87654321", groups: ["02"] }], "2096b": [{ id: "87654321", groups: ["02"] }] }
  const view = { semester: "2096a", courses: { ...before, "2096a": [] } }
  const changes = annualChanges(before, view)
  acceptAnnualFeed({ version: 1, years: { "2096": data } })
  expect(applyAnnualChanges(view, changes, importCatalogs({}))).toEqual({ courses: view.courses, pending: [] })
})

test("corrected classification retires obsolete course/group edits without touching semester selections", () => {
  for (const [year, groups] of [["2095", { "87654321": ["02"] }], ["2094", { "12345678": ["02"] }]] as const) {
    acceptAnnualFeed({ version: 1, years: { [year]: data } })
    const course = { id: "12345678", groups: ["01"] }
    const before = { [`${year}a`]: [course], [`${year}b`]: [course] }
    const view = { semester: `${year}a`, courses: { ...before, [`${year}a`]: [] } }
    const pending = applyAnnualChanges(view, annualChanges(before, view), importCatalogs({})).pending
    expect(pending).toHaveLength(1)
    acceptAnnualFeed({ version: 1, years: { [year]: { ...data, verifiedAt: "2026-09-10", groups } } })
    expect(applyAnnualChanges(view, pending, importCatalogs({}))).toEqual({ courses: view.courses, pending: [] })
  }
})

test("removing a custom annual source retires its edit when the year is classified", () => {
  const course = { id: "local", groups: ["01"] }
  const view = { semester: "2026a", courses: { "2026a": [], "2026b": [course] },
    customCourses: { custom: { local: { groups: [{ group: "01", lessons: [{ type: "שנתי" }] }] } } } }
  const changes = annualChanges({ "2026a": [course] }, view)
  expect(changes).toHaveLength(1)
  expect(applyAnnualChanges({ ...view, customCourses: {} }, changes, importCatalogs({}))).toEqual({ courses: view.courses, pending: [] })
})
