import { expect, test } from "bun:test"
import { changeWorkspace, initializeWorkspace, readWorkspaceRecord, acceptCloud, resetWorkspace, legacyChanged, acknowledgeLegacy, WORKSPACE_KEY } from "../src/workspaceStore"
import { normalizePlans } from "../src/plans"
import { scheduleKey } from "../src/scheduleSync"
import { withWorkspaceStorage } from "./workspace-fixture"

const initial = normalizePlans({ semester: "2026a", courses: { "2026a": [{ id: "math" }] } })
test("migration is idempotent, retains legacy bytes, and detects later old-tab edits without importing them", async () => {
  await withWorkspaceStorage(initial, async storage => {
    const legacy = storage.values.get("Dib It")
    await Promise.all([initializeWorkspace(), initializeWorkspace()])
    expect(storage.writes()).toBe(1)
    expect(storage.values.get("Dib It")).toBe(legacy)
    const before = readWorkspaceRecord()
    storage.values.set("Dib It", JSON.stringify({ ...initial, theme: "google" }))
    expect(legacyChanged()).toBe(true)
    expect(readWorkspaceRecord()).toEqual(before)
    await expect(acknowledgeLegacy(legacy!)).rejects.toThrow("הנתונים השתנו")
    await acknowledgeLegacy(storage.values.get("Dib It")!)
    expect(legacyChanged()).toBe(false)
  })
})
test("overlapping writers derive inside the lock; exceptions and quota errors release it", async () => {
  await withWorkspaceStorage(initial, async storage => {
    await initializeWorkspace()
    await Promise.all(["syntax", "logic"].map(id => changeWorkspace(workspace => ({ ...workspace, plans: workspace.plans.map(plan => ({ ...plan, courses: {
      ...plan.courses, "2026a": [...plan.courses!["2026a"]!, { id }],
    } })) }))))
    expect(readWorkspaceRecord().workspace.plans[0]!.courses!["2026a"]!.map(course => course.id)).toEqual(["math", "syntax", "logic"])
    const before = storage.recordRaw()
    await expect(changeWorkspace(() => { throw new Error("derive") })).rejects.toThrow("derive")
    storage.fail()
    await expect(changeWorkspace(value => ({ ...value, theme: "google" }))).rejects.toThrow("Quota")
    expect(storage.recordRaw()).toBe(before)
    storage.recover()
    await changeWorkspace(value => ({ ...value, theme: "google" }))
    expect(readWorkspaceRecord().workspace.theme).toBe("google")
  })
})
test("a delayed cloud merge cannot replace newer edits or falsely acknowledge the merged baseline", async () => {
  await withWorkspaceStorage(initial, async () => {
    await initializeWorkspace()
    const expected = readWorkspaceRecord()
    const merged = { ...initial, theme: "google" as const }
    await changeWorkspace(value => ({ ...value, openedPracticeCourses: ["math"] }))
    expect(await acceptCloud(expected, "alice", merged, 2, 100, "merge")).toBe(false)
    expect(readWorkspaceRecord().workspace.openedPracticeCourses).toEqual(["math"])
    expect(readWorkspaceRecord().sync).toBeUndefined()
    const newer = readWorkspaceRecord()
    await changeWorkspace(value => ({ ...value, theme: "apple" }))
    // Ordinary edits descend from the uploaded snapshot: acknowledge that snapshot only.
    expect(await acceptCloud(newer, "alice", newer.workspace, 3, 110, false)).toBe(false)
    expect(readWorkspaceRecord().sync?.base).toBe(scheduleKey(newer.workspace))
  })
})
test("local storage failure leaves both contents and sync history unchanged; cancellation is checked after lock acquisition", async () => {
  await withWorkspaceStorage(initial, async storage => {
    await initializeWorkspace()
    const expected = readWorkspaceRecord(), before = storage.recordRaw()
    storage.fail()
    await expect(acceptCloud(expected, "alice", { ...initial, theme: "google" }, 2, 100, "download")).rejects.toThrow("Quota")
    expect(storage.recordRaw()).toBe(before)
    storage.recover()
    await expect(acceptCloud(expected, "alice", initial, 2, 100, "download", () => false)).rejects.toThrow("הסנכרון הופסק")
    expect(storage.recordRaw()).toBe(before)
  })
})
test("reset works on corrupted data, clears the receipt and prevents legacy resurrection; unsupported browsers never write", async () => {
  await withWorkspaceStorage(initial, async storage => {
    storage.values.set(WORKSPACE_KEY, "broken")
    await resetWorkspace()
    await initializeWorkspace()
    expect(readWorkspaceRecord().workspace).toEqual(normalizePlans({}))
    expect(readWorkspaceRecord().sync).toBeUndefined()
    expect(storage.values.has("Dib It")).toBe(false)
    const before = storage.recordRaw()
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} })
    await expect(changeWorkspace(value => ({ ...value, theme: "google" }))).rejects.toThrow("הדפדפן אינו תומך")
    expect(storage.recordRaw()).toBe(before)
  })
})
