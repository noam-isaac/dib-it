import { z } from "zod"
import { storedWorkspaceSchema, workspaceSchema } from "./schemas"
import { normalizePlans, type PlanWorkspace } from "./plans"
import { scheduleKey, withLocalNavigation } from "./scheduleSync"

export const WORKSPACE_KEY = "Dib It Workspace v2"
export const WORKSPACE_LOCK = "dibit:workspace"
export const LEGACY_KEY = "Dib It"
const syncSchema = z.object({ uid: z.string(), base: z.string().nullable().optional(), revision: z.number().int().nonnegative().optional(), savedAt: z.number().nullable().optional() })
const recordSchema = z.object({
  format: z.literal(2), version: z.string(), epoch: z.string(), workspace: workspaceSchema,
  time: z.object({ at: z.number(), source: z.enum(["device", "google"]) }).nullable(),
  sync: syncSchema.optional(), legacy: z.string().nullable(),
})
export type WorkspaceRecord = z.infer<typeof recordSchema>
export const coordinationAvailable = () => typeof navigator !== "undefined" && typeof navigator.locks?.request === "function"
export class StaleWorkspaceError extends Error {
  constructor() { super("הנתונים השתנו מאז שההשוואה נפתחה. פתחו השוואה מעודכנת לפני שמירה.") }
}
const notify = (key = WORKSPACE_KEY) => window.dispatchEvent(new StorageEvent("storage", { key }))
const legacyRecord = (): WorkspaceRecord => {
  const legacy = localStorage.getItem(LEGACY_KEY)
  const saved = localStorage.getItem("Dib It Sync")
  // An unreadable old sync receipt must not make the schedule unreadable or become a merge base.
  const sync = (() => { try { return syncSchema.parse(JSON.parse(saved ?? "null")) } catch { return undefined } })()
  return { format: 2, version: "legacy", epoch: "legacy", workspace: normalizePlans(storedWorkspaceSchema.parse(JSON.parse(legacy ?? "{}"))), time: null, legacy, ...(sync ? { sync } : {}) }
}
export const readWorkspaceRecord = (): WorkspaceRecord => {
  const raw = localStorage.getItem(WORKSPACE_KEY)
  return raw === null ? legacyRecord() : recordSchema.parse(JSON.parse(raw))
}
const persist = (record: WorkspaceRecord): WorkspaceRecord => {
  const next = recordSchema.parse({ ...record, version: crypto.randomUUID() })
  // One setItem replaces contents and their receipt together. A quota failure leaves the old record intact.
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next))
  notify()
  return next
}
export const withWorkspaceLock = <T>(operation: () => T): Promise<T> => {
  const task = coordinationAvailable()
    ? navigator.locks.request(WORKSPACE_LOCK, () => {
      // Firefox reports rejected lock callbacks globally even when the request is caught.
      // Carry the failure out of the callback, then reject the caller's promise normally.
      try { return { value: operation() } } catch (error) { return { error } }
    }).then((result: { value: T } | { error: unknown }) => { if ("error" in result) throw result.error; return result.value })
    : Promise.reject<T>(new Error("הדפדפן אינו תומך בשמירה מתואמת. אפשר לצפות ולהוריד גיבוי; כדי לערוך, פתחו בדפדפן עדכני."))
  // Event handlers may intentionally ignore completion; awaited callers still receive the rejection.
  void task.catch((error: unknown) => window.dispatchEvent(new CustomEvent("workspace-error", { detail: error })))
  return task
}
export const initializeWorkspace = (readOlder?: () => PlanWorkspace | undefined) => {
  if (!coordinationAvailable()) return Promise.resolve()
  return withWorkspaceLock(() => {
    if (localStorage.getItem(WORKSPACE_KEY) !== null) { readWorkspaceRecord(); return }
    const record = legacyRecord()
    const older = record.legacy === null ? readOlder?.() : undefined
    persist({ ...record, epoch: crypto.randomUUID(), workspace: older ?? record.workspace })
  })
}
export const changeWorkspace = (update: (workspace: PlanWorkspace) => PlanWorkspace, replacement = false) => withWorkspaceLock(() => {
  const record = readWorkspaceRecord()
  const updated = update(record.workspace)
  if (!replacement && updated === record.workspace) return record
  const workspace = workspaceSchema.parse(updated)
  if (!replacement && JSON.stringify(workspace) === JSON.stringify(record.workspace)) return record
  const changed = replacement || scheduleKey(workspace) !== scheduleKey(record.workspace)
  return persist({ ...record, workspace, epoch: replacement ? crypto.randomUUID() : record.epoch, time: changed ? { at: Date.now(), source: "device" } : record.time })
})
export const captureWorkspace = () => withWorkspaceLock(readWorkspaceRecord)

/** Network work is finished before entering this operation. A newer local edit always survives. */
export const acceptCloud = (expected: WorkspaceRecord, uid: string, workspace: PlanWorkspace, revision: number, savedAt: number | null, apply: "download" | "merge" | false, active: () => boolean = () => true) => withWorkspaceLock(() => {
  if (!active()) throw new Error("הסנכרון הופסק. הנתונים במכשיר לא הוחלפו.")
  const current = readWorkspaceRecord()
  if (current.sync?.uid === uid && current.sync.base === scheduleKey(workspace) && current.sync.revision === revision && scheduleKey(current.workspace) === scheduleKey(workspace) && current.sync.savedAt === savedAt) return true
  const sync = { uid, base: scheduleKey(workspace), revision, savedAt }
  if (current.version !== expected.version) {
    // Ordinary edits still descend from the uploaded local snapshot. A merge/download or
    // explicit replacement does not: acknowledging those here would invent deletions.
    if (!apply && current.epoch === expected.epoch && JSON.stringify(current.sync) === JSON.stringify(expected.sync) && scheduleKey(expected.workspace) === sync.base)
      persist({ ...current, sync })
    return false
  }
  const next = apply ? withLocalNavigation(workspace, current.workspace) : current.workspace
  if (JSON.stringify(current.sync) === JSON.stringify(sync) && JSON.stringify(next) === JSON.stringify(current.workspace)) return true
  persist({ ...current, workspace: next, sync, epoch: apply ? crypto.randomUUID() : current.epoch,
    time: apply && scheduleKey(next) !== scheduleKey(current.workspace) ? apply === "merge" ? { at: Date.now(), source: "device" } : savedAt === null ? null : { at: savedAt, source: "google" } : current.time })
  return true
})
export const legacyChanged = (record = readWorkspaceRecord()) => localStorage.getItem(LEGACY_KEY) !== record.legacy
export const acknowledgeLegacy = (expected: string | null) => withWorkspaceLock(() => {
  if (localStorage.getItem(LEGACY_KEY) !== expected) throw new StaleWorkspaceError()
  return persist({ ...readWorkspaceRecord(), legacy: expected })
})
/** A replacement tombstone prevents startup from resurrecting old data, including after partial cleanup. */
export const resetWorkspace = () => withWorkspaceLock(() => {
  // Stop automatic downloads from repopulating a deliberate local reset on reload.
  localStorage.setItem("Automatic Google Sync", "false")
  notify("Automatic Google Sync")
  persist({ format: 2, version: "", epoch: crypto.randomUUID(), workspace: normalizePlans({}), time: { at: Date.now(), source: "device" }, legacy: null })
  ;[LEGACY_KEY, "Dib It Sync", "Hidden Tabs"].forEach(key => localStorage.removeItem(key))
  notify(LEGACY_KEY)
})
export const workspaceRecoveryData = () => {
  try { return JSON.stringify(readWorkspaceRecord().workspace) }
  catch { return localStorage.getItem(WORKSPACE_KEY) ?? localStorage.getItem(LEGACY_KEY) ?? "{}" }
}
