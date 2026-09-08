import { expect, test } from "bun:test"
import { activePlanView, normalizePlans, reconcileActivePlan, updateActivePlan, addPlan } from "../src/plans"
import { isScheduleBackup } from "../src/scheduleBackup"
import catalogs from "./fixtures/annual-catalogs-2026.json"
import { annualChanges, applyAnnualChanges } from "../src/annualCourses"

const course = { id: "10313103", groups: ["01"] }
const initial = () => normalizePlans({ semester: "2026a", courses: { "2026a": [structuredClone(course)], "2026b": [structuredClone(course)] } })
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value))

test("semester-only group edits preserve the other semester's annual selection", () => {
  for (const available of [{}, catalogs]) {
    const workspace = normalizePlans({ semester: "2026a", courses: {
      "2026a": [{ ...course, groups: [] }], "2026b": [course],
    } })
    const result = updateActivePlan(workspace, { ...activePlanView(workspace), courses: {
      "2026a": [{ ...course, groups: ["02"] }], "2026b": [course],
    } }, available)
    expect(result.plans[0].courses!["2026b"]).toEqual([course])
    expect(result.plans[0].pendingAnnualChanges).toBeUndefined()
    expect(reconcileActivePlan(roundTrip(result), catalogs).plans[0].courses!["2026b"]).toEqual([course])
  }
})

test("a loaded but incomplete catalog cannot discard removals or deselections", () => {
  for (const semester of ["2026a", "2026b"]) for (const remove of [false, true]) {
    const workspace = initial()
    const changed = { ...activePlanView(workspace), courses: {
      "2026a": remove ? [] : [{ ...course, groups: [] }], "2026b": [course],
    } }
    const incomplete = { ...catalogs, [semester]: {} }
    const waiting = updateActivePlan(workspace, changed, incomplete)
    expect(waiting.plans[0].pendingAnnualChanges).toHaveLength(1)
    expect(isScheduleBackup(waiting)).toBe(true)
    const completed = reconcileActivePlan(roundTrip(waiting), catalogs)
    expect(completed.plans[0].courses).toEqual({
      "2026a": remove ? [] : [{ ...course, groups: [] }],
      "2026b": remove ? [] : [{ ...course, groups: [] }],
    })
    expect(completed.plans[0].pendingAnnualChanges).toBeUndefined()
  }
})

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
  for (const pendingAnnualChanges of [null, {}, [null], [{ semester: "2026c", id: "x", groups: [] }], [{ semester: "2026a", id: "x", groups: [1] }], [{ semester: "2026a", id: "", groups: null }], [{ semester: "2026a", id: "x", groups: [], changedGroups: [1] }]]) {
    const workspace = initial()
    expect(isScheduleBackup({ ...workspace, plans: [{ ...workspace.plans[0], pendingAnnualChanges }] })).toBe(false)
  }
})

test("annual deltas preserve untouched selections and metadata and replay idempotently", () => {
  const customCourses = { test: { mixed: { groups: ["01", "02"].map(group => ({
    group, lessons: [{ type: "שנתי" }],
  })) } } }
  const selections = Array.from({ length: 8 }, (_, mask) => ["01", "02", "03"].filter((_, bit) => mask & (1 << bit)))
  for (const before of selections) for (const after of selections) for (const peer of selections) {
    const previous = { "2026a": [{ id: "mixed", groups: before }], "2026b": [{ id: "mixed", groups: peer, color: "blue" }] }
    const view = { semester: "2026a", customCourses, courses: { ...previous, "2026a": [{ id: "mixed", groups: after }] } }
    const snapshot = roundTrip(view)
    const changes = annualChanges(previous, view)
    const result = applyAnnualChanges(view, changes, {})
    const target = result.courses["2026b"].find(course => course.id === "mixed")
    for (const group of ["01", "02", "03"]) {
      const editedAnnual = group !== "03" && before.includes(group) !== after.includes(group)
      expect(target?.groups?.includes(group) ?? false).toBe(editedAnnual ? after.includes(group) : peer.includes(group))
    }
    if (target) expect(target.color).toBe("blue")
    expect(applyAnnualChanges({ ...view, courses: result.courses }, changes, {})).toEqual(result)
    expect(view).toEqual(snapshot)
  }
})

test("older pending selections without delta metadata still restore safely", () => {
  const workspace = initial()
  workspace.plans[0].pendingAnnualChanges = [{ semester: "2026a", id: course.id, groups: null }]
  expect(isScheduleBackup(workspace)).toBe(true)
  const result = reconcileActivePlan(roundTrip(workspace), catalogs)
  expect(result.plans[0].courses).toEqual({ "2026a": [], "2026b": [] })
  expect(result.plans[0].pendingAnnualChanges).toBeUndefined()
})

test("a later edit cannot overtake a blocked edit of the same annual course", () => {
  const id = "08421400"
  const groups = ["01", "02"].map(group => ({ group, lessons: [] }))
  const complete = { "2026a": { [id]: { groups } }, "2026b": { [id]: { groups } } }
  const incomplete = { ...complete, "2026b": { [id]: { groups: groups.slice(0, 1) } } }
  let workspace = normalizePlans({ semester: "2026a", courses: {
    "2026a": [{ id, groups: ["01", "02"] }], "2026b": [{ id, groups: ["01", "02"] }],
  } })
  workspace = updateActivePlan(workspace, { ...activePlanView(workspace), courses: {
    ...workspace.plans[0].courses, "2026a": [],
  } }, incomplete)
  workspace = updateActivePlan(workspace, { ...activePlanView(workspace), courses: {
    ...workspace.plans[0].courses, "2026a": [{ id, groups: ["01"] }],
  } }, incomplete)
  expect(workspace.plans[0].pendingAnnualChanges).toHaveLength(2)
  const result = reconcileActivePlan(roundTrip(workspace), complete)
  expect(result.plans[0].courses).toEqual({ "2026a": [{ id, groups: ["01"] }], "2026b": [{ id, groups: ["01"] }] })
})

test("missing classification cannot acknowledge pending changes from another snapshot", () => {
  for (const change of [
    { semester: "2099a", id: course.id, groups: null, changedGroups: ["01"] },
    { semester: "2026a", id: course.id, groups: null, changedGroups: ["99"] },
  ]) {
    const view = activePlanView(initial())
    const result = applyAnnualChanges(view, [change], catalogs)
    expect(result.pending).toEqual([change])
    expect(result.courses).toEqual(view.courses)
  }
})
