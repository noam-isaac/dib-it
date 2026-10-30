import { describe, expect, test } from "bun:test"
import { getDibIt, getWorkspace, setWorkspace, updateDibIt, reconcileCatalogs } from "../src/models"
import { activePlanView, addPlan, deletePlan, normalizePlans, reconcileActivePlan, updateActivePlan } from "../src/plans"
import { storedWorkspaceSchema, type DibIt } from "../src/schemas"
import { cacheSemesterCourses } from "../src/catalogData"
import { acceptAnnualFeed } from "../src/annualRegistry"
import { importCatalogs } from "./catalog-fixtures"
import annualCatalogs from "./fixtures/annual-catalogs-2026.json"
import { acceptGoogleCopy, readLocalCopy } from "../src/localSchedule"
import { scheduleKey } from "../src/scheduleSync"

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const legacy = () => ({
  semester: "2026a", tab: "schedule", theme: "apple" as const,
  courses: { "2026a": [{ id: "regular", groups: ["01"], color: "red", note: "retain" }], "2025b": [{ id: "old" }] },
  school: "Faculty", studyPlan: "Program", degreeStartYear: "2025",
  savedStudyPlans: [{ school: "Faculty", studyPlan: "Program", note: "retain" }],
  practicedExams: { regular: ["2025a"] }, openedPracticeCourses: ["regular"],
  customCourses: { local: { custom: { name: "Custom", note: "retain", groups: [] } } },
  userMetadata: { note: "retain" },
})

// Exercise the real storage/schema/event boundary; module mocks would bypass the contract.
const withStorage = (initial: unknown, check: (storage: {
  raw: () => string | null; writes: () => number; events: () => number; fail: () => void
}) => void) => {
  const keys = ["localStorage", "window", "StorageEvent"] as const
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  let raw = initial === undefined ? null : JSON.stringify(initial)
  const metadata = new Map<string, string>()
  let writes = 0, events = 0, failed = false
  class TestStorageEvent extends Event {
    constructor(type: string, readonly init: { key: string; newValue: string }) { super(type) }
  }
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: {
      getItem: (key: string) => key === "Dib It" ? raw : metadata.get(key) ?? null,
      removeItem: (key: string) => { if (key === "Dib It") raw = null; else metadata.delete(key) },
      setItem: (key: string, value: string) => {
        if (failed) throw new Error("Quota exceeded")
        if (key !== "Dib It") { metadata.set(key, value); return }
        raw = value
        writes += 1
      },
    } },
    window: { configurable: true, value: { dispatchEvent: () => { events += 1 } } },
    StorageEvent: { configurable: true, value: TestStorageEvent },
  })
  try { check({ raw: () => raw, writes: () => writes, events: () => events, fail: () => { failed = true } }) }
  finally {
    keys.forEach((key, index) => {
      const descriptor = descriptors[index]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
}

test("copy times match saved content, survive navigation and become unknown after an older writer", () => {
  withStorage(normalizePlans(legacy()), () => {
    expect(readLocalCopy().time).toBeNull()
    updateDibIt(current => ({ ...current, theme: "google" }))
    const time = readLocalCopy().time
    expect(time?.source).toBe("device")
    updateDibIt(current => ({ ...current, tab: "exams" }))
    expect(readLocalCopy().time).toEqual(time)
    localStorage.setItem("Dib It", JSON.stringify({ ...getWorkspace(), theme: "apple" }))
    expect(readLocalCopy().time).toBeNull()
  })
})

test("delayed cloud application retains newer local changes and their previous baseline", () => {
  withStorage(normalizePlans(legacy()), () => {
    const expected = readLocalCopy()
    updateDibIt(current => ({ ...current, theme: "google" }))
    const before = localStorage.getItem("Dib It")
    expect(acceptGoogleCopy(expected, "test", { workspace: expected.workspace, revision: 1, savedAt: 123 }, "download", () => true)).toBe(false)
    expect(localStorage.getItem("Dib It")).toBe(before)
    expect(readLocalCopy().sync).toBeUndefined()
    expect(() => acceptGoogleCopy(readLocalCopy(), "test", { workspace: expected.workspace, revision: 1, savedAt: 123 }, "download", () => false)).toThrow("הסנכרון הופסק")
  })
})

test("download failures never acknowledge an unapplied copy; receipt failure retains the downloaded contents", () => {
  withStorage(normalizePlans(legacy()), storage => {
    const expected = readLocalCopy()
    storage.fail()
    expect(() => acceptGoogleCopy(expected, "test", { workspace: { ...expected.workspace, theme: "google" }, revision: 1, savedAt: 123 }, "download", () => true)).toThrow("Quota")
    expect(readLocalCopy().workspace).toEqual(expected.workspace)
    expect(readLocalCopy().sync).toBeUndefined()
  })
  withStorage(normalizePlans(legacy()), () => {
    const expected = readLocalCopy(), incoming = { ...expected.workspace, theme: "google" as const }
    const original = localStorage.setItem
    localStorage.setItem = (key, value) => { if (key === "Dib It Sync") throw new Error("Receipt quota"); original(key, value) }
    expect(() => acceptGoogleCopy(expected, "test", { workspace: incoming, revision: 1, savedAt: 123 }, "download", () => true)).toThrow("Receipt quota")
    expect(scheduleKey(getWorkspace())).toBe(scheduleKey(incoming))
    expect(readLocalCopy().time).toEqual({ at: 123, source: "google" })
    expect(readLocalCopy().sync).toBeUndefined()
  })
})

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") Object.values(value).forEach(freeze)
  return Object.freeze(value)
}

describe("atomic workspace persistence", () => {
  test("callbacks created together apply to the latest state, preserving unrelated plan and shared data", () => {
    const initial = addPlan(normalizePlans(legacy()), "Second", true)
    const expectedId = initial.activePlanId
    const addCourse = () => updateDibIt(current => ({ ...current, courses: {
      ...current.courses, "2026a": [...current.courses!["2026a"]!, { id: "added", groups: [] }],
    } }), expectedId, "2026a")
    const recolor = () => updateDibIt(current => ({ ...current, courses: {
      ...current.courses, "2026a": current.courses!["2026a"]!.map(course => course.id === "regular" ? { ...course, color: "blue" } : course),
    } }), expectedId, "2026a")
    withStorage(initial, storage => {
      addCourse()
      updateDibIt(current => ({ ...current, tab: "exams", theme: "google" }), expectedId)
      recolor()
      const saved = getWorkspace()
      expect(saved.plans[0]).toEqual(initial.plans[0])
      expect(saved.plans[1]).toEqual({ ...initial.plans[1], courses: {
        ...initial.plans[1]!.courses, "2026a": [{ ...legacy().courses["2026a"][0], color: "blue" }, { id: "added", groups: [] }],
      } })
      expect(getDibIt()).toMatchObject({ ...legacy(), tab: "exams", theme: "google", courses: saved.plans[1]!.courses })
      expect(storage.writes()).toBe(3)
      expect(storage.events()).toBe(3)
      expect(storedWorkspaceSchema.parse(JSON.parse(storage.raw()!))).toEqual(saved)
    })
  })

  test("a stale switched-plan callback is rejected before evaluating its updater", () => {
    const original = normalizePlans(legacy())
    const switched = addPlan(original, "Other")
    withStorage(switched, storage => {
      updateDibIt(() => { throw new Error("must not run") }, original.activePlanId, "2026a")
      expect(getWorkspace()).toEqual(clone(switched))
      expect(storage.writes()).toBe(0)
      expect(storage.events()).toBe(0)
    })
  })

  test("deleted and recreated plans get a different identity and reject the deleted plan callback", () => {
    const original = addPlan(normalizePlans(legacy()), "Transient")
    const recreated = addPlan(deletePlan(original, original.activePlanId), "Transient")
    expect(recreated.activePlanId).not.toBe(original.activePlanId)
    withStorage(recreated, storage => {
      updateDibIt(() => { throw new Error("must not run") }, original.activePlanId)
      expect(getWorkspace()).toEqual(clone(recreated))
      expect(storage.writes()).toBe(0)
    })
  })

  test("returning to the same plan accepts its callback without discarding edits to another plan", () => {
    const original = addPlan(normalizePlans(legacy()), "Second")
    withStorage(original, () => {
      const staleId = original.activePlanId
      setWorkspace({ ...getWorkspace(), activePlanId: "default" })
      updateDibIt(current => ({ ...current, school: "Changed first" }), "default")
      setWorkspace({ ...getWorkspace(), activePlanId: staleId })
      updateDibIt(current => ({ ...current, studyPlan: "Changed second" }), staleId)
      expect(getWorkspace().plans[0]!.school).toBe("Changed first")
      expect(getDibIt().studyPlan).toBe("Changed second")
    })
  })

  test("a same-reference no-op does not write, emit, or migrate legacy bytes", () => {
    withStorage(legacy(), storage => {
      const before = storage.raw()
      updateDibIt(current => current, "default")
      expect(storage.raw()).toBe(before)
      expect(storage.writes()).toBe(0)
      expect(storage.events()).toBe(0)
    })
  })

  test("an empty store can be initialized and then updated without losing the first edit", () => {
    withStorage(undefined, storage => {
      updateDibIt(current => ({ ...current, semester: "2026a", courses: { "2026a": [{ id: "first" }] } }))
      updateDibIt(current => ({ ...current, school: "Faculty" }))
      expect(getDibIt()).toMatchObject({ semester: "2026a", courses: { "2026a": [{ id: "first" }] }, school: "Faculty" })
      expect(storage.writes()).toBe(2)
    })
  })

  test("legacy data migrates on edit and preserves all old semesters and passthrough metadata", () => {
    withStorage(legacy(), storage => {
      updateDibIt(current => ({ ...current, semester: "2026b" }), "default")
      const saved = JSON.parse(storage.raw()!)
      expect(saved.plans).toHaveLength(1)
      expect(getDibIt()).toEqual({ ...legacy(), semester: "2026b", activePlanId: "default" })
      expect(normalizePlans(storedWorkspaceSchema.parse(clone(saved)))).toEqual(getWorkspace())
    })
  })

  test.each([
    undefined, null, { semester: "bad" }, { courses: { "2026a": [{ id: "" }] } },
    { courses: { "2026a": [{ id: "bad", groups: [1] }] } }, { theme: "purple" },
    { savedStudyPlans: [{ school: "Faculty", studyPlan: "" }] },
  ])("invalid updater result %# leaves exact persisted bytes and event count intact", result => {
    withStorage(legacy(), storage => {
      const before = storage.raw()
      expect(() => updateDibIt(() => result as unknown as DibIt)).toThrow()
      expect(storage.raw()).toBe(before)
      expect(storage.writes()).toBe(0)
      expect(storage.events()).toBe(0)
    })
  })

  test("an updater exception and quota failure preserve the last successfully saved workspace", () => {
    withStorage(legacy(), storage => {
      updateDibIt(current => ({ ...current, tab: "exams" }))
      const before = storage.raw()
      expect(() => updateDibIt(() => { throw new Error("edit failed") })).toThrow("edit failed")
      storage.fail()
      expect(() => updateDibIt(current => ({ ...current, courses: {} }))).toThrow("Quota exceeded")
      expect(storage.raw()).toBe(before)
      expect(getDibIt()).toEqual({ ...legacy(), tab: "exams", activePlanId: "default" })
      expect(storage.writes()).toBe(1)
      expect(storage.events()).toBe(1)
    })
  })

  test("malformed stored data surfaces without invoking an updater or replacing the recoverable bytes", () => {
    for (const invalid of [{ plans: [] }, { activePlanId: "missing", plans: [{ id: "a", name: "A" }] }]) {
      withStorage(invalid, storage => {
        const before = storage.raw()
        expect(() => updateDibIt(() => { throw new Error("must not run") })).toThrow()
        expect(storage.raw()).toBe(before)
        expect(storage.writes()).toBe(0)
      })
    }
  })
})

describe("atomic annual workspace edits", () => {
  const course = { id: "10313103", groups: ["01"], color: "red" }
  test.each(["2026b", "2027a"])("all 512 annual deltas honor the edited semester while navigation stays at %s", semester => {
    const groups = ["01", "02", "03"]
    const subsets = Array.from({ length: 8 }, (_, mask) => groups.filter((_, bit) => mask & (1 << bit)))
    subsets.forEach(before => subsets.forEach(after => subsets.forEach(peer => {
      const source = addPlan(normalizePlans({ ...legacy(), semester, customCourses: { local: { mixed: {
        groups: ["01", "02"].map(group => ({ group, lessons: [{ type: "שנתי" }] })),
      } } }, courses: {
        "2026a": [{ id: "mixed", groups: before, color: "red" }],
        "2026b": [{ id: "mixed", groups: peer, color: "blue", studyPlanCategory: "peer" }],
      } }), "Other", true)
      const snapshot = clone(source), workspace = freeze(source)
      const view = freeze({ ...activePlanView(workspace), courses: { ...activePlanView(workspace).courses,
        "2026a": [{ id: "mixed", groups: after, color: "red" }],
      } })
      const result = updateActivePlan(workspace, view, {}, "2026a")
      const target = result.plans[1]!.courses!["2026b"]!.find(item => item.id === "mixed")
      groups.forEach(group => {
        const changedAnnual = group !== "03" && before.includes(group) !== after.includes(group)
        expect(target?.groups?.includes(group) ?? false).toBe(changedAnnual ? after.includes(group) : peer.includes(group))
      })
      if (target) expect(target).toMatchObject({ color: "blue", studyPlanCategory: "peer" })
      expect(result.plans[0]).toEqual(snapshot.plans[0])
      expect({ ...result, plans: workspace.plans }).toEqual(workspace)
      expect(workspace).toEqual(snapshot)
      expect(updateActivePlan(freeze(result), freeze(activePlanView(result)), {}, "2026a")).toEqual(result)
    })))
  })

  test.each(["2026b", "2027a"])("frozen edits reconcile their original semester while navigation stays at %s", semester => {
    const source = addPlan(normalizePlans({ semester, theme: "google", courses: { "2026a": [course], "2026b": [course] } }), "Other", true)
    const before = clone(source)
    const workspace = freeze(source)
    const view = freeze({ ...activePlanView(workspace), courses: { ...activePlanView(workspace).courses, "2026a": [] } })
    const catalogs = freeze(importCatalogs(annualCatalogs))
    const result = updateActivePlan(workspace, view, catalogs, "2026a")
    expect(workspace).toEqual(before)
    expect(result.semester).toBe(semester)
    expect(result.plans[0]).toEqual(before.plans[0])
    expect(result.plans[1]!.courses).toEqual({ "2026a": [], "2026b": [] })
    expect(result.plans[1]!.pendingAnnualChanges).toBeUndefined()
    expect(reconcileActivePlan(freeze(clone(result)), catalogs)).toEqual(result)
  })

  test.each(["2026a", "2026b"])("an incomplete %s catalog queues edit intent through round trips and replays once", missing => {
    const initial = freeze(normalizePlans({ semester: "2026b", courses: { "2026a": [course], "2026b": [{ ...course, color: "blue" }] } }))
    const catalogs = importCatalogs({ ...annualCatalogs, [missing]: {} })
    const edited = updateActivePlan(initial, { ...activePlanView(initial), courses: { ...initial.plans[0]!.courses, "2026a": [{ ...course, groups: [] }] } }, catalogs, "2026a")
    expect(edited.semester).toBe("2026b")
    expect(edited.plans[0]!.pendingAnnualChanges).toHaveLength(1)
    expect(edited.plans[0]!.courses!["2026b"]).toEqual([{ ...course, color: "blue" }])
    const restored = storedWorkspaceSchema.parse(clone(edited))
    const waiting = reconcileActivePlan(freeze(normalizePlans(restored)), catalogs)
    expect(waiting).toEqual(edited)
    const completed = reconcileActivePlan(waiting, importCatalogs(annualCatalogs))
    expect(completed.plans[0]!.courses).toEqual({ "2026a": [{ ...course, groups: [] }], "2026b": [{ ...course, color: "blue", groups: [] }] })
    expect(completed.plans[0]!.pendingAnnualChanges).toBeUndefined()
    expect(reconcileActivePlan(completed, importCatalogs(annualCatalogs))).toEqual(completed)
  })

  test("actual storage-backed annual edits use the captured semester after navigation and replay after catalogs arrive", () => {
    const year = "2078", first = `${year}a`, second = `${year}b`, id = "98765432"
    const catalogs = { [id]: { groups: [{ group: "01", lessons: [] }] } }
    acceptAnnualFeed({ version: 1, years: { [year]: { source: "https://www.ims.tau.ac.il/Tal/KR/Search_P.aspx", filter: "ckSem=0", verifiedAt: "2026-10-28", groups: { [id]: ["01"] } } } })
    withStorage({ semester: first, courses: { [first]: [{ id, groups: ["01"] }], [second]: [{ id, groups: ["01"], color: "blue" }] } }, storage => {
      updateDibIt(current => ({ ...current, semester: "2079a" }), "default")
      updateDibIt(current => ({ ...current, courses: { ...current.courses, [first]: [] } }), "default", first)
      expect(getDibIt().semester).toBe("2079a")
      expect(getWorkspace().plans[0]!.pendingAnnualChanges).toHaveLength(1)
      cacheSemesterCourses(first, catalogs)
      reconcileCatalogs()
      expect(getWorkspace().plans[0]!.pendingAnnualChanges).toHaveLength(1)
      cacheSemesterCourses(second, catalogs)
      reconcileCatalogs()
      expect(getDibIt().courses).toEqual({ [first]: [], [second]: [] })
      expect(getDibIt().semester).toBe("2079a")
      expect(getWorkspace().plans[0]!.pendingAnnualChanges).toBeUndefined()
      const writes = storage.writes()
      reconcileCatalogs()
      expect(storage.writes()).toBe(writes)
    })
  })

  test("pure stale-plan guard preserves a frozen workspace and its queued annual intent", () => {
    const first = normalizePlans({ semester: "2026a", courses: { "2026a": [course], "2026b": [course] } })
    const queued = updateActivePlan(first, { ...activePlanView(first), courses: { "2026a": [], "2026b": [course] } })
    const workspace = freeze(addPlan(queued, "Other"))
    expect(updateActivePlan(workspace, { ...activePlanView(queued), courses: {} }, importCatalogs(annualCatalogs))).toBe(workspace)
    expect(workspace.plans[0]).toEqual(queued.plans[0])
  })
})
