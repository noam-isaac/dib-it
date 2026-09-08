import { expect, test } from "bun:test"
import { activePlanView, normalizePlans, reconcileActivePlan, updateActivePlan, addPlan } from "../src/plans"
import { isScheduleBackup } from "../src/scheduleBackup"
import catalogs from "./fixtures/annual-catalogs-2026.json"

const course = { id: "10313103", groups: ["01"] }
const initial = () => normalizePlans({ semester: "2026a", courses: { "2026a": [structuredClone(course)], "2026b": [structuredClone(course)] } })
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value))

test("offline removal and deselection survive reload, backups, and either catalog arrival order", () => {
  for (const remove of [false, true]) for (const first of ["2026a", "2026b"]) {
    let workspace = initial()
    const edited = activePlanView(workspace)
    edited.courses = { ...edited.courses, "2026a": remove ? [] : [{ ...course, groups: [] }] }
    workspace = updateActivePlan(workspace, edited, {})
    expect(workspace.plans[0].pendingAnnualChanges).toHaveLength(1)
    expect(isScheduleBackup(workspace)).toBe(true)
    workspace = roundTrip(workspace)
    workspace = reconcileActivePlan(workspace, { [first]: catalogs[first] })
    expect(workspace.plans[0].pendingAnnualChanges).toHaveLength(1)
    workspace = reconcileActivePlan(workspace, catalogs)
    expect(workspace.plans[0].courses!["2026a"]).toEqual(remove ? [] : [{ ...course, groups: [] }])
    expect(workspace.plans[0].courses!["2026b"]).toEqual(remove ? [] : [{ ...course, groups: [] }])
    expect(workspace.plans[0].pendingAnnualChanges).toBeUndefined()
    expect(reconcileActivePlan(workspace, catalogs)).toEqual(workspace)
  }
})

test("the last explicit edit wins when both semesters are edited offline", () => {
  let workspace = initial()
  workspace = updateActivePlan(workspace, { ...activePlanView(workspace), courses: { "2026a": [], "2026b": [course] } })
  workspace = updateActivePlan(workspace, { ...activePlanView(workspace), semester: "2026b", courses: { "2026a": [], "2026b": [{ ...course, groups: [] }] } })
  workspace = updateActivePlan(workspace, { ...activePlanView(workspace), courses: { "2026a": [], "2026b": [course] } })
  const result = reconcileActivePlan(roundTrip(workspace), catalogs)
  expect(result.plans[0].courses).toEqual({ "2026a": [course], "2026b": [course] })
  expect(result.plans[0].pendingAnnualChanges).toBeUndefined()
})

test("loading and no-op saves preserve conflicting selections and semester-specific metadata", () => {
  const before = normalizePlans({ semester: "2026a", courses: {
    "2026a": [{ ...course, color: "red", studyPlanCategory: "one" }],
    "2026b": [{ ...course, groups: [], color: "blue", studyPlanCategory: "two" }],
  } })
  expect(reconcileActivePlan(before, catalogs)).toEqual(before)
  expect(updateActivePlan(before, activePlanView(before), catalogs)).toEqual(before)
  expect(updateActivePlan(before, { ...activePlanView(before), tab: "exams" }, catalogs).plans).toEqual(before.plans)
})

test("pending edits stay with their plan, survive duplication, and cannot affect a restored workspace", () => {
  const before = initial()
  const edited = updateActivePlan(before, { ...activePlanView(before), courses: { "2026a": [], "2026b": [course] } })
  const switched = addPlan(edited, "Second")
  expect(reconcileActivePlan(switched, catalogs).plans[0]).toEqual(edited.plans[0])
  const duplicated = addPlan(edited, "Copy", true)
  const reconciled = reconcileActivePlan(duplicated, catalogs)
  expect(reconciled.plans[0]).toEqual(edited.plans[0])
  expect(reconciled.plans[1].courses).toEqual({ "2026a": [], "2026b": [] })
  expect(reconcileActivePlan(roundTrip(before), catalogs)).toEqual(before)
})

test("invalid pending operations are rejected at the backup boundary", () => {
  for (const pendingAnnualChanges of [null, {}, [null], [{ semester: "2026c", id: "x", groups: [] }], [{ semester: "2026a", id: "x", groups: [1] }], [{ semester: "2026a", id: "", groups: null }]]) {
    const workspace = initial()
    expect(isScheduleBackup({ ...workspace, plans: [{ ...workspace.plans[0], pendingAnnualChanges }] })).toBe(false)
  }
})
