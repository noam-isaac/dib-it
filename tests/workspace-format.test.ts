import { expect, test } from "bun:test"
import { activePlanView, normalizePlans, updateActivePlan } from "../src/plans"
import { decodeWorkspace, UnsupportedWorkspaceVersionError, workspaceContent, workspaceVersion } from "../src/workspaceFormat"

const plan = (id = "one") => ({ id, name: id, courses: { "2026a": [{ id: "course", groups: ["01"], note: "course metadata" }] } })
const legacy = () => ({ activePlanId: "one", semester: "2026b", tab: "exams", plans: [plan()] })
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") Object.values(value).forEach(freeze)
  return Object.freeze(value)
}

test("navigation has one owner and a valid legacy fallback is used only once", () => {
  const input = { ...legacy(), plans: [{ ...plan(), semester: "2026a", tab: { retired: true } }] }
  const before = structuredClone(input)
  const migrated = decodeWorkspace(freeze(input))
  expect(activePlanView(migrated)).toMatchObject({ semester: "2026b", tab: "exams" })
  expect(migrated.plans[0]).toMatchObject({ semester: "2026a", tab: { retired: true } })
  expect(input).toEqual(before)
  expect(decodeWorkspace(migrated)).toEqual(migrated)
  const fallback = decodeWorkspace({ activePlanId: "one", plans: [{ ...plan(), semester: "2026a", tab: "schedule" }] })
  expect(fallback).toMatchObject({ semester: "2026a", tab: "schedule", schemaVersion: 1 })
  const cleared = { ...fallback, semester: undefined, tab: undefined }
  expect(activePlanView(decodeWorkspace(JSON.parse(JSON.stringify(cleared))))).not.toHaveProperty("semester")
  expect(activePlanView(decodeWorkspace(JSON.parse(JSON.stringify(cleared))))).not.toHaveProperty("tab")
  expect(decodeWorkspace({ activePlanId: "one", plans: [{ ...plan(), semester: { obsolete: true } }] }).semester).toBeUndefined()
  expect(() => decodeWorkspace({ ...legacy(), semester: 22 })).toThrow()
})

test("old root course/program fallbacks become explicit plan values without removing originals", () => {
  const courses = { "2025b": [{ id: "inherited", groups: ["02"] }] }
  const pendingAnnualChanges = [{ semester: "2025b", id: "inherited", groups: null }]
  const input = { ...legacy(), courses, school: "Faculty", studyPlan: "Program", pendingAnnualChanges,
    plans: [{ id: "one", name: "inherits", note: "plan metadata" }, { ...plan("two"), school: "Other" }] }
  const migrated = decodeWorkspace(input)
  expect(migrated.plans[0]).toMatchObject({ courses, school: "Faculty", studyPlan: "Program", note: "plan metadata" })
  expect(migrated.plans[1]).toMatchObject({ courses: plan("two").courses, school: "Other", studyPlan: "Program" })
  expect(migrated).toMatchObject({ courses, school: "Faculty", pendingAnnualChanges })
  expect(migrated.plans.every(item => item.pendingAnnualChanges === undefined)).toBe(true)
  expect(decodeWorkspace({ ...migrated, plans: migrated.plans.map(item => ({ ...item, courses: undefined })) }).plans.every(item => item.courses === undefined)).toBe(true)
})

test("shared legacy values promote only when every effective value agrees", () => {
  const customCourses = { personal: { custom: { name: "Custom", groups: [] } } }
  const candidates = [plan(), plan("two")].map(item => ({ ...item, customCourses, theme: "google" }))
  const promoted = decodeWorkspace({ ...legacy(), plans: candidates })
  expect(promoted).toMatchObject({ customCourses, theme: "google" })
  expect(promoted.plans).toEqual(candidates)
  expect(() => decodeWorkspace({ ...legacy(), plans: [candidates[0], { ...plan("two"), theme: "google" }] })).toThrow("הקורסים האישיים")
  expect(() => decodeWorkspace({ ...legacy(), customCourses: {}, plans: candidates })).toThrow("הקורסים האישיים")
  expect(() => decodeWorkspace({ ...legacy(), practicedExams: {}, plans: [{ ...plan(), practicedExams: { course: ["2025a"] } }] })).toThrow("המבחנים שתורגלו")
  expect(() => decodeWorkspace({ ...legacy(), plans: [{ ...plan(), customCourses: null }] })).toThrow()
})

test("current-version archived values stay inactive even when malformed or contradictory", () => {
  const current = { ...legacy(), schemaVersion: 1, courses: 42, theme: "apple", customCourses: {},
    plans: [{ ...plan(), semester: { retired: true }, customCourses: "obsolete", theme: "not-a-theme" }] }
  const decoded = decodeWorkspace(current)
  expect(activePlanView(decoded)).toMatchObject({ theme: "apple", customCourses: {}, courses: plan().courses, semester: "2026b" })
  expect(decoded).toEqual(current)
})

test("explicit edit ownership preserves unfamiliar metadata without moving it between owners", () => {
  const decoded = decodeWorkspace({ ...legacy(), rootNote: { retain: true }, plans: [{ ...plan(), planNote: ["retain"], semester: "2026a" }] })
  const view = activePlanView(decoded)
  expect(view).not.toHaveProperty("rootNote")
  expect(view).not.toHaveProperty("planNote")
  const updated = updateActivePlan(decoded, { ...view, theme: "google", school: "New faculty", tab: "schedule" })
  expect(updated).toMatchObject({ rootNote: { retain: true }, theme: "google", tab: "schedule" })
  expect(updated).not.toHaveProperty("planNote")
  expect(updated.plans[0]).toMatchObject({ school: "New faculty", planNote: ["retain"], semester: "2026a" })
  expect(updated.plans[0]).not.toHaveProperty("theme")
  expect(updated.plans[0]).not.toHaveProperty("rootNote")
})

test("semantic comparison ignores only known archived fields and navigation", () => {
  const base = decodeWorkspace(legacy())
  const archived = decodeWorkspace({ ...base, semester: "2026a", courses: "retired", school: "retired", pendingAnnualChanges: "retired",
    plans: [{ ...base.plans[0], semester: "2025b", tab: "retired", activePlanId: "retired", practicedExams: "retired" }] })
  expect(workspaceContent(archived)).toEqual(workspaceContent(base))
  expect(workspaceContent(base)).toHaveProperty("schemaVersion", 1)
  expect(workspaceContent(decodeWorkspace({ ...base, unfamiliar: "root", plans: [{ ...base.plans[0], unfamiliar: "plan" }] })))
    .toMatchObject({ unfamiliar: "root", plans: [{ unfamiliar: "plan" }] })
  expect(workspaceContent(decodeWorkspace({ ...base, theme: "google" }))).not.toEqual(workspaceContent(base))
})

test("historical baseline interpretation does not depend on a reconstructed active plan", () => {
  const input = { school: "Faculty", plans: [{ ...plan(), semester: "2026a" }, { ...plan("two"), semester: "2026b" }] }
  expect(workspaceContent(decodeWorkspace({ ...input, activePlanId: "one" })))
    .toEqual(workspaceContent(decodeWorkspace({ ...input, activePlanId: "two" })))
})

test("unknown versions and invalid active data are rejected without mutating input", () => {
  for (const schemaVersion of [0, 2, "1", null, undefined, { future: true }]) {
    const input = { ...legacy(), schemaVersion }
    const before = structuredClone(input)
    expect(() => decodeWorkspace(input)).toThrow(UnsupportedWorkspaceVersionError)
    expect(input).toEqual(before)
  }
  expect(workspaceVersion(legacy())).toBe(0)
  expect(workspaceVersion(decodeWorkspace(legacy()))).toBe(1)
  expect(() => decodeWorkspace({ ...legacy(), plans: [] })).toThrow()
  expect(() => decodeWorkspace({ ...legacy(), activePlanId: "missing" })).toThrow()
  expect(() => decodeWorkspace({ ...legacy(), plans: [{ ...plan(), courses: { "2026a": [{ id: "course", groups: [1] }] } }] })).toThrow()
})

test("single-schedule legacy data keeps all semesters and unfamiliar data through round trips", () => {
  const input = { courses: plan().courses, school: "Faculty", semester: "2026a", userMetadata: { retain: true } }
  const decoded = decodeWorkspace(input)
  expect(decoded).toMatchObject({ schemaVersion: 1, userMetadata: { retain: true }, courses: input.courses })
  expect(activePlanView(decoded)).toEqual({ activePlanId: "default", semester: "2026a", school: "Faculty", courses: input.courses })
  expect(normalizePlans(JSON.parse(JSON.stringify(decoded)))).toEqual(decoded)
  expect(decoded.plans[0]?.courses).toEqual(input.courses)
})
