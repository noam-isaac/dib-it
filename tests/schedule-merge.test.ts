import { expect, test } from "bun:test"
import { normalizePlans } from "../src/plans"
import { compareSchedules, sharedMergeBase } from "../src/scheduleMerge"
import { scheduleKey } from "../src/scheduleSync"

const workspace = (...ids: string[]) => normalizePlans({ semester: "2026a", courses: { "2026a": ids.map(id => ({ id, groups: ["01"], note: "keep" })) } })
const ids = (value: ReturnType<typeof compareSchedules>) => value.workspace?.plans[0]?.courses?.["2026a"]?.map(course => course.id)
test("independent additions and removals merge without resurrection or mutating inputs", () => {
  const base = workspace("math", "literature"), local = workspace("literature", "syntax"), remote = workspace("math", "literature", "logic")
  const original = JSON.stringify([base, local, remote])
  const result = compareSchedules(base, local, remote)
  expect(ids(result)).toEqual(["literature", "syntax", "logic"])
  expect(result.unresolved).toHaveLength(0)
  expect(JSON.stringify([base, local, remote])).toBe(original)
  expect(result.workspace?.plans[0]?.courses?.["2026a"]?.every(course => course.note === "keep")).toBe(true)
  expect(sharedMergeBase(scheduleKey(base))?.plans).toEqual(base.plans)
})
test("same-course and delete/edit conflicts preserve unrelated additions for either explicit choice", () => {
  const base = workspace("math"), local = workspace("syntax"), remote = workspace("math", "logic")
  remote.plans[0]!.courses!["2026a"]![0]!.groups = ["02"]
  const result = compareSchedules(base, local, remote)
  expect(result.unresolved).toHaveLength(1)
  expect(result.workspace).toBeUndefined()
  const key = result.unresolved[0]!.key
  expect(ids(compareSchedules(base, local, remote, { [key]: "local" }))).toEqual(["syntax", "logic"])
  expect(ids(compareSchedules(base, local, remote, { [key]: "remote" }))).toEqual(["math", "syntax", "logic"])
})
test("annual semesters and pending intent are one course/year decision", () => {
  const base = workspace("annual"), local = structuredClone(base), remote = structuredClone(base)
  local.plans[0]!.courses!["2026b"] = [{ id: "annual", groups: ["02"] }]
  local.plans[0]!.pendingAnnualChanges = [{ semester: "2026b", id: "annual", groups: ["02"] }]
  remote.plans[0]!.courses!["2026a"]![0]!.groups = ["03"]
  const result = compareSchedules(base, local, remote)
  expect(result.unresolved).toHaveLength(1)
  const chosen = compareSchedules(base, local, remote, { [result.unresolved[0]!.key]: "local" }).workspace!
  expect(chosen.plans[0]!.courses).toEqual(local.plans[0]!.courses)
  expect(chosen.plans[0]!.pendingAnnualChanges).toEqual(local.plans[0]!.pendingAnnualChanges)
})
test("plan deletion versus editing, missing baseline, duplicate IDs and all-plan deletion cannot silently merge", () => {
  const base = workspace("math")
  base.plans.push({ id: "second", name: "Other", courses: {} })
  const local = { ...base, plans: [base.plans[0]!] }, remote = structuredClone(base)
  remote.plans[1]!.name = "Edited"
  expect(compareSchedules(base, local, remote).unresolved[0]?.kind).toBe("plan")
  expect(compareSchedules(undefined, local, remote).workspace).toBeUndefined()
  expect(compareSchedules(undefined, local, local).changes).toHaveLength(0)
  expect(compareSchedules(base, workspace("math", "math"), remote).reason).toContain("יותר מפעם")
  expect(compareSchedules(base, local, { ...base, activePlanId: "second", plans: [base.plans[1]!] }).workspace).toBeUndefined()
})
test("ordering, unknown metadata and custom-catalog dependencies are explicit", () => {
  const base = workspace("a", "b", "c"), local = workspace("b", "a", "c"), remote = workspace("a", "c", "b")
  const result = compareSchedules(base, local, remote)
  expect(result.unresolved.map(row => row.kind)).toEqual(["order"])
  expect(ids(compareSchedules(base, local, remote, { [result.unresolved[0]!.key]: "remote" }))).toEqual(["a", "c", "b"])
  const extra = { ...base, userMetadata: { retained: true } }
  expect((compareSchedules(base, extra, workspace("a", "b", "c", "d")).workspace as typeof extra).userMetadata).toEqual({ retained: true })
  expect(compareSchedules(base, { ...base, customCourses: { local: { x: { name: "Custom" } } } }, workspace("a", "b", "c", "d")).reason).toContain("קורסים האישיים")
})
