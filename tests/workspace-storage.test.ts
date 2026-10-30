import { describe, expect, test } from "bun:test"
import { getWorkspace, reconcileCatalogs, setWorkspace, updateDibIt } from "../src/models"
import { MIGRATION_RECOVERY_KEY, recoveryData, resetPreferences, resetWorkspace } from "../src/preferences"
import { decodeWorkspace, UnsupportedWorkspaceVersionError } from "../src/workspaceFormat"
import { getMigrationRecovery, readWorkspace, writeWorkspace } from "../src/workspaceStorage"

const raw = '{\n  "semester": "2026a", "courses": {"2026a": [{"id":"old","groups":["01"]}]}, "note":"original"\n}'
const withStorage = (initial: Record<string, string>, run: (state: {
  data: Map<string, string>; writes: string[]; events: string[]
  fail: (key: string | undefined) => void; intercept: (callback?: (key: string, value: string) => void) => void
  denyRemoval: (key: string | undefined) => void
}) => void) => {
  const names = ["localStorage", "window", "StorageEvent"] as const
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
  const data = new Map(Object.entries(initial)), writes: string[] = [], events: string[] = []
  let failed: string | undefined, failedRemoval: string | undefined, beforeSet: ((key: string, value: string) => void) | undefined
  class StorageChange extends Event {
    constructor(type: string, readonly init: StorageEventInit) { super(type) }
  }
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: {
      get length() { return data.size }, key: (index: number) => [...data.keys()][index] ?? null,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === failed) throw new Error(`Quota ${key}`)
        beforeSet?.(key, value)
        data.set(key, value); writes.push(key)
      },
      removeItem: (key: string) => { if (key === failedRemoval) throw new Error(`Denied ${key}`); data.delete(key) },
    } },
    window: { configurable: true, value: { dispatchEvent: (event: Event) => { events.push(event.type) } } },
    StorageEvent: { configurable: true, value: StorageChange },
  })
  try { run({ data, writes, events, fail: key => { failed = key }, intercept: callback => { beforeSet = callback }, denyRemoval: key => { failedRemoval = key } }) }
  finally {
    names.forEach((name, index) => {
      const descriptor = descriptors[index]
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
}

describe("versioned workspace storage", () => {
  test("reads, no-op edits and unchanged catalog reconciliation leave original bytes alone", () => {
    withStorage({ "Dib It": raw }, ({ data, writes }) => {
      expect(getWorkspace().schemaVersion).toBe(1)
      updateDibIt(current => current)
      reconcileCatalogs()
      expect(data.get("Dib It")).toBe(raw)
      expect(writes).toEqual([])
    })
    withStorage({}, ({ data, writes }) => {
      expect(getWorkspace().plans).toHaveLength(1)
      expect(data.size).toBe(0)
      expect(writes).toEqual([])
    })
  })

  test("legacy multi-key reads are pure and the first edit preserves every original string", () => {
    const legacy = { Semester: '"2026a"', Courses: '["old"]', "Groups 2026a": '{"old":["01"]}', Colors: '{"old":"red"}',
      "Taken Courses (Dib It Serialize)": "retired malformed bytes", "Dib It Sync": '{"uid":"original"}' }
    withStorage(legacy, ({ data, writes, events }) => {
      expect(readWorkspace().plans[0]?.courses?.["2026a"]).toEqual([{ id: "old", groups: ["01"], color: "red" }])
      expect(Object.fromEntries(data)).toEqual(legacy)
      updateDibIt(current => ({ ...current, theme: "google" }))
      const backup = getMigrationRecovery()!
      expect(backup.storage).toEqual(legacy)
      expect(backup.format).toBe("dibit-migration-recovery")
      expect(JSON.parse(data.get("Dib It")!).schemaVersion).toBe(1)
      expect(writes.slice(0, 2)).toEqual([MIGRATION_RECOVERY_KEY, "Dib It"])
      expect(events.filter(type => type === "storage")).toHaveLength(1)
      expect(data.has("Courses")).toBe(false)
    })
  })

  test("snapshot and primary failures never commit, and an interrupted migration retries safely", () => {
    for (const failedKey of [MIGRATION_RECOVERY_KEY, "Dib It"]) withStorage({ "Dib It": raw }, state => {
      state.fail(failedKey)
      expect(() => updateDibIt(current => ({ ...current, theme: "google" }))).toThrow("Quota")
      expect(state.data.get("Dib It")).toBe(raw)
      expect(state.events).not.toContain("storage")
      expect(state.events).toContain("workspace-save-error")
      if (failedKey === "Dib It") expect(JSON.parse(state.data.get(MIGRATION_RECOVERY_KEY)!).pending.package.storage["Dib It"]).toBe(raw)
      state.fail(undefined)
      updateDibIt(current => ({ ...current, theme: "google" }))
      expect(getWorkspace().theme).toBe("google")
      expect(getMigrationRecovery()?.storage["Dib It"]).toBe(raw)
    })
  })

  test("an observed source change during preservation aborts without overwriting the newer copy", () => {
    withStorage({ "Dib It": raw }, state => {
      const newer = JSON.stringify({ ...JSON.parse(raw), theme: "apple" })
      state.intercept(key => { if (key === MIGRATION_RECOVERY_KEY) state.data.set("Dib It", newer) })
      expect(() => writeWorkspace({ ...getWorkspace(), theme: "google" })).toThrow("הנתונים השתנו")
      expect(state.data.get("Dib It")).toBe(newer)
      expect(state.events).not.toContain("storage")
    })
  })

  test("committed version remains authoritative when legacy cleanup fails", () => {
    withStorage({ Courses: '["old"]', Semester: '"2026a"' }, state => {
      state.denyRemoval("Courses")
      updateDibIt(current => ({ ...current, theme: "google" }))
      expect(state.data.has("Courses")).toBe(true)
      expect(readWorkspace().theme).toBe("google")
      const committed = state.data.get("Dib It")
      expect(() => resetWorkspace()).toThrow("Denied")
      expect(state.data.get("Dib It")).toBe(committed)
      state.denyRemoval(undefined)
      resetWorkspace()
      expect(state.data.has("Courses")).toBe(false)
      expect(state.data.has("Dib It")).toBe(false)
    })
  })

  test("normal edits retain recovery; the next confirmed legacy import replaces only the latest package", () => {
    withStorage({ "Dib It": raw, "unrelated": "keep" }, state => {
      updateDibIt(current => ({ ...current, theme: "google" }))
      const first = state.data.get(MIGRATION_RECOVERY_KEY)
      updateDibIt(current => ({ ...current, tab: "exams" }))
      expect(state.data.get(MIGRATION_RECOVERY_KEY)).toBe(first)
      const before = state.data.get("Dib It")
      const incoming = '{\n"semester":"2026b", "courses":{"2026b":[{"id":"imported"}]}\n}'
      setWorkspace(decodeWorkspace(JSON.parse(incoming)), { kind: "file", raw: incoming })
      const latest = getMigrationRecovery()!
      const latestJournal = state.data.get(MIGRATION_RECOVERY_KEY)
      expect(latest.storage["Dib It"]).toBe(before)
      expect(latest.incoming).toEqual({ kind: "file", raw: incoming })
      expect(getWorkspace().plans[0]?.courses?.["2026b"]?.[0]?.id).toBe("imported")
      const exportData = JSON.parse(recoveryData())
      expect(exportData.storage[MIGRATION_RECOVERY_KEY]).toBe(state.data.get(MIGRATION_RECOVERY_KEY))
      resetPreferences()
      expect(state.data.get(MIGRATION_RECOVERY_KEY)).toBe(latestJournal)
      resetWorkspace()
      expect(Object.fromEntries(state.data)).toEqual({ unrelated: "keep" })
    })
  })

  test("future local or incoming versions cannot be overwritten; malformed local bytes are archived on explicit recovery", () => {
    const replacement = decodeWorkspace({ semester: "2026a", courses: {} })
    for (const schemaVersion of [2, "1", null]) withStorage({ "Dib It": JSON.stringify({ ...replacement, schemaVersion }) }, state => {
      const before = state.data.get("Dib It")
      expect(() => setWorkspace(replacement)).toThrow(UnsupportedWorkspaceVersionError)
      expect(state.data.get("Dib It")).toBe(before)
      expect(state.writes).toEqual([])
    })
    withStorage({ "Dib It": raw }, state => {
      expect(() => setWorkspace(replacement, { kind: "file", raw: '{"schemaVersion":2}' })).toThrow(UnsupportedWorkspaceVersionError)
      expect(state.data.get("Dib It")).toBe(raw)
      expect(state.writes).toEqual([])
    })
    for (const corrupted of ["{broken", '{"schemaVersion":1,"plans":[],"activePlanId":"bad"}']) withStorage({ "Dib It": corrupted }, state => {
      setWorkspace(replacement)
      expect(getMigrationRecovery()?.storage["Dib It"]).toBe(corrupted)
      expect(getWorkspace().schemaVersion).toBe(1)
    })
  })

  test("ambiguous or incomplete historical layouts fail without modifying their source", () => {
    for (const legacy of [
      { Semester: '"2026a"', Courses: '["old"]', "Courses 2026a": '["other"]' },
      { Semester: '"2026a"', Courses: '["old"]', Groups: '{"old":["01"]}', "Groups 2026a": '{"old":["02"]}' },
      { "Groups 2026a": '{"old":["01"]}' },
    ]) withStorage(legacy, ({ data, writes }) => {
      expect(() => getWorkspace()).toThrow()
      expect(Object.fromEntries(data)).toEqual(legacy)
      expect(writes).toEqual([])
    })
  })

  test("a failed second migration retains the previous successful recovery package", () => {
    withStorage({ "Dib It": raw }, state => {
      updateDibIt(current => ({ ...current, theme: "google" }))
      const first = getMigrationRecovery(), primary = state.data.get("Dib It")
      const incoming = '{"semester":"2026b","courses":{"2026b":[{"id":"second"}]}}'
      const committedJournal = state.data.get(MIGRATION_RECOVERY_KEY)
      state.fail(MIGRATION_RECOVERY_KEY)
      expect(() => setWorkspace(decodeWorkspace(JSON.parse(incoming)), { kind: "file", raw: incoming })).toThrow("Quota")
      expect(state.data.get("Dib It")).toBe(primary)
      expect(state.data.get(MIGRATION_RECOVERY_KEY)).toBe(committedJournal)
      state.fail("Dib It")
      expect(() => setWorkspace(decodeWorkspace(JSON.parse(incoming)), { kind: "file", raw: incoming })).toThrow("Quota")
      expect(state.data.get("Dib It")).toBe(primary)
      expect(getMigrationRecovery()).toEqual(first)
      const journal = JSON.parse(state.data.get(MIGRATION_RECOVERY_KEY)!)
      expect(journal.committed).toEqual(first)
      expect(journal.pending.package.storage["Dib It"]).toBe(primary)
      expect(journal.pending.package.incoming.raw).toBe(incoming)
      state.fail(undefined)
      setWorkspace(decodeWorkspace(JSON.parse(incoming)), { kind: "file", raw: incoming })
      expect(getMigrationRecovery()?.storage["Dib It"]).toBe(primary)
      expect(getMigrationRecovery()?.incoming?.raw).toBe(incoming)
      expect(JSON.parse(state.data.get(MIGRATION_RECOVERY_KEY)!).pending).toBeUndefined()
    })
  })

  test("promotion failure after primary commit is success; later changes wait for settlement", () => {
    withStorage({ "Dib It": raw }, state => {
      state.intercept(key => { if (key === "Dib It") state.fail(MIGRATION_RECOVERY_KEY) })
      updateDibIt(current => ({ ...current, theme: "google" }))
      expect(getWorkspace().theme).toBe("google")
      expect(getMigrationRecovery()?.storage["Dib It"]).toBe(raw)
      expect(state.events).not.toContain("workspace-save-error")
      expect(state.events.filter(type => type === "storage")).toHaveLength(1)
      const primary = state.data.get("Dib It"), journal = state.data.get(MIGRATION_RECOVERY_KEY)
      // Reload-like recovery reads cannot promote or mutate either key.
      expect(readWorkspace().theme).toBe("google")
      expect(getMigrationRecovery()?.storage["Dib It"]).toBe(raw)
      expect(state.data.get(MIGRATION_RECOVERY_KEY)).toBe(journal)
      expect(() => updateDibIt(current => ({ ...current, theme: "apple" }))).toThrow("Quota")
      expect(state.data.get("Dib It")).toBe(primary)
      expect(getMigrationRecovery()?.storage["Dib It"]).toBe(raw)
      state.fail(undefined); state.intercept()
      updateDibIt(current => ({ ...current, theme: "apple" }))
      expect(getWorkspace().theme).toBe("apple")
      expect(getMigrationRecovery()?.storage["Dib It"]).toBe(raw)
      expect(JSON.parse(state.data.get(MIGRATION_RECOVERY_KEY)!).pending).toBeUndefined()
    })
  })

  test("abandoned staging must settle before a later ordinary write matches its target", () => {
    withStorage({ "Dib It": raw }, state => {
      updateDibIt(current => ({ ...current, theme: "google" }))
      const first = getMigrationRecovery(), primary = state.data.get("Dib It")
      const incoming = '{"semester":"2026b","courses":{"2026b":[{"id":"abandoned"}]}}'
      const target = decodeWorkspace(JSON.parse(incoming))
      state.fail("Dib It")
      expect(() => setWorkspace(target, { kind: "file", raw: incoming })).toThrow("Quota")
      state.fail(MIGRATION_RECOVERY_KEY)
      expect(() => setWorkspace(target)).toThrow("Quota")
      expect(state.data.get("Dib It")).toBe(primary)
      expect(getMigrationRecovery()).toEqual(first)
      state.fail(undefined)
      setWorkspace(target)
      expect(getWorkspace().plans[0]?.courses?.["2026b"]?.[0]?.id).toBe("abandoned")
      expect(getMigrationRecovery()).toEqual(first)
      expect(JSON.parse(state.data.get(MIGRATION_RECOVERY_KEY)!).pending).toBeUndefined()
    })
  })

  test("equivalent imports do not rotate recovery or stage an ambiguous target", () => {
    withStorage({ "Dib It": raw }, state => {
      updateDibIt(current => ({ ...current, theme: "google" }))
      const primary = state.data.get("Dib It")!, recovery = state.data.get(MIGRATION_RECOVERY_KEY)
      const { schemaVersion: _, ...equivalentLegacy } = JSON.parse(primary)
      state.fail("Dib It")
      setWorkspace(getWorkspace(), { kind: "file", raw: JSON.stringify(equivalentLegacy) })
      expect(state.data.get("Dib It")).toBe(primary)
      expect(state.data.get(MIGRATION_RECOVERY_KEY)).toBe(recovery)
    })
  })

  test("unknown or corrupt journals remain recoverable and block every subsequent write", () => {
    for (const broken of ["{broken", '{"format":"dibit-migration-journal","version":2,"committed":null}',
      '{"format":"dibit-migration-journal","version":1,"committed":null,"pending":{"target":"broken","package":{}}}']) {
      withStorage({ "Dib It": raw, [MIGRATION_RECOVERY_KEY]: broken }, state => {
        expect(() => updateDibIt(current => ({ ...current, theme: "google" }))).toThrow()
        expect(state.data.get("Dib It")).toBe(raw)
        expect(state.data.get(MIGRATION_RECOVERY_KEY)).toBe(broken)
        expect(JSON.parse(recoveryData()).storage[MIGRATION_RECOVERY_KEY]).toBe(broken)
        expect(state.writes).toEqual([])
      })
    }
  })

  test("future primary is rejected before pending recovery can be promoted or discarded", () => {
    withStorage({ "Dib It": raw }, state => {
      state.intercept(key => { if (key === "Dib It") state.fail(MIGRATION_RECOVERY_KEY) })
      updateDibIt(current => ({ ...current, theme: "google" }))
      const replacement = getWorkspace(), journal = state.data.get(MIGRATION_RECOVERY_KEY)
      state.fail(undefined); state.intercept()
      const future = JSON.stringify({ ...replacement, schemaVersion: 2 })
      state.data.set("Dib It", future)
      expect(() => setWorkspace({ ...replacement, theme: "apple" })).toThrow(UnsupportedWorkspaceVersionError)
      expect(state.data.get("Dib It")).toBe(future)
      expect(state.data.get(MIGRATION_RECOVERY_KEY)).toBe(journal)
    })
  })
})
