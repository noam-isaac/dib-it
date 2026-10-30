import { workspaceSchema } from "./schemas"
import { normalizePlans, type PlanWorkspace } from "./plans"
import { isScheduleBackup } from "./scheduleBackup"

export class CloudScheduleError extends Error {}
export class LocalSyncSaveError extends Error {
  constructor(uploaded: boolean, readonly cause: unknown) {
    super(uploaded
      ? "העותק נשמר בגוגל, אך השלמת הסנכרון במכשיר נכשלה. הורידו גיבוי ורעננו את ההשוואה לפני ניסיון נוסף."
      : "השלמת הסנכרון במכשיר נכשלה. הורידו גיבוי ורעננו את ההשוואה לפני ניסיון נוסף.")
  }
}

/** Size rules: https://firebase.google.com/docs/firestore/storage-size */
export const cloudScheduleData = (workspace: PlanWorkspace, uid: string, overhead = 0): PlanWorkspace => {
  const bytes = (text: string) => new TextEncoder().encode(text).length + 1
  const invalid = () => { throw new CloudScheduleError("מבנה הנתונים אינו מתאים לגיבוי בגוגל. הנתונים נשמרו במכשיר ואפשר להוריד גיבוי לקובץ.") }
  const tooLarge = () => { throw new CloudScheduleError("הנתונים חורגים ממגבלת הגיבוי בגוגל (1 MiB). הנתונים נשמרו במכשיר ואפשר להוריד גיבוי לקובץ. הקטינו קטלוגים אישיים או מערכות שמורות לפני ניסיון נוסף.") }
  let data: PlanWorkspace
  try { data = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)) as unknown) }
  catch { return invalid() }
  const size = (value: unknown, depth = 0): number => {
    if (value === null || typeof value === "boolean") return 1
    if (typeof value === "number") return 8
    if (typeof value === "string") {
      if (bytes(value) > 1048487) return tooLarge()
      return bytes(value)
    }
    if (depth > 20) return invalid()
    if (Array.isArray(value)) return (value as unknown[]).reduce<number>((total, item) => {
      if (Array.isArray(item)) invalid()
      return total + size(item, depth + 1)
    }, 0)
    if (!value || typeof value !== "object") return invalid()
    return 32 + Object.entries(value).reduce((total, [key, item]) => {
      if (bytes(key) - 1 > 1500 || /^__.*__$/.test(key)) invalid()
      return total + bytes(key) + size(item, depth + 1)
    }, 0)
  }
  if (size(data) + bytes("users") + bytes(uid) + 16 + overhead > 1048576)
    tooLarge()
  return data
}

export const readCloudSchedule = (data: unknown): PlanWorkspace | null => {
  if (data === undefined) return null
  if (!isScheduleBackup(data)) throw new Error("הגיבוי בגוגל אינו תקין. המערכות המקומיות לא השתנו.")
  return normalizePlans(data)
}

// Firestore does not preserve object-key order. Navigation stays on each device.
export const scheduleKey = (workspace: PlanWorkspace | null): string | null => {
  if (!workspace) return null
  const { tab: _tab, semester: _semester, activePlanId: _active, ...data } = workspace
  return JSON.stringify(data, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Record<string, unknown>)[key]])) : value)
}

export type SyncDecision = "equal" | "upload" | "download" | "conflict"
export const syncDecision = (local: PlanWorkspace, remote: PlanWorkspace | null, base: string | null | undefined): SyncDecision => {
  const localKey = scheduleKey(local)
  const remoteKey = scheduleKey(remote)
  if (localKey === remoteKey) return "equal"
  if (base !== undefined) {
    if (localKey === base && remote) return "download"
    if (remoteKey === base) return "upload"
    return "conflict"
  }
  if (!remote) return "upload"
  const empty = normalizePlans({})
  empty.plans[0]!.courses = local.plans[0]?.courses && {}
  if (localKey === scheduleKey(empty)) return "download"
  return "conflict"
}

export const withLocalNavigation = (remote: PlanWorkspace, local: PlanWorkspace): PlanWorkspace => ({
  ...remote,
  semester: local.semester ?? remote.semester,
  tab: local.tab ?? remote.tab,
  activePlanId: remote.plans.some(plan => plan.id === local.activePlanId) ? local.activePlanId : remote.activePlanId,
})

export type CloudCopy = { workspace: PlanWorkspace; revision: number; savedAt: number | null }
export type LocalCopy = {
  workspace: PlanWorkspace; version: string; time: { at: number; source: "device" | "google" } | null
  sync?: { uid: string; base?: string | null | undefined; revision?: number | undefined; savedAt?: number | null | undefined } | undefined
}
export type SyncReview = { local: LocalCopy; remote: CloudCopy | null }
export type SyncStatus = "connecting" | "syncing" | "synced" | "conflict" | "pending" | "error"
export type SyncChoice = "upload" | "download" | "merge"
export const cloudCopyKey = (copy: CloudCopy | null) => JSON.stringify([copy?.revision ?? null, scheduleKey(copy?.workspace ?? null)])
export const baseForAccount = (record: LocalCopy, uid: string) => record.sync && record.sync.uid !== uid ? "different-account" : record.sync?.base
export type SyncOptions = {
  uid: string
  read: () => LocalCopy
  accept: (expected: LocalCopy, copy: CloudCopy, apply: "download" | "merge" | false, active: () => boolean) => Promise<boolean>
  exchange: (decide: (remote: CloudCopy | null) => PlanWorkspace | undefined) => Promise<{ before: CloudCopy | null; after: CloudCopy | null }>
  prepare: (workspace: PlanWorkspace) => PlanWorkspace
  status: (status: SyncStatus, review?: SyncReview, error?: unknown) => void
}

/** Each tab has a queue; cloud transactions protect devices. Local-tab serialization is deferred. */
export const startScheduleSync = (options: SyncOptions) => {
  let stopped = false
  let busy = false
  let queued = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolution: { review: SyncReview; choice: SyncChoice; merged?: PlanWorkspace } | undefined
  let blockedVersion: string | undefined

  const schedule = (delay = 1000) => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(() => { void run() }, delay)
  }
  const run = async () => {
    if (stopped) return
    if (busy) { queued = true; return }
    busy = true
    queued = false
    const chosen = resolution
    resolution = undefined
    let attempted: string | undefined
    try {
      const local = options.read()
      if (blockedVersion === local.version && !chosen) return
      attempted = local.version
      blockedVersion = undefined
      let decision = "equal" as SyncDecision
      options.status("syncing")
      const exchange = await options.exchange(remote => {
        if (stopped) throw new Error("Sync stopped")
        const stale = chosen && (local.version !== chosen.review.local.version ||
          options.read().version !== local.version || cloudCopyKey(remote) !== cloudCopyKey(chosen.review.remote))
        decision = stale ? "conflict" : chosen ? chosen.choice === "download" ? "download" : "upload"
          : syncDecision(local.workspace, remote?.workspace ?? null, baseForAccount(local, options.uid))
        const replacement = chosen?.choice === "merge" ? chosen.merged : local.workspace
        // A newly arrived catalog must not silently change an approved merge.
        if (decision === "upload" && chosen?.choice === "merge" && (!replacement ||
          scheduleKey(options.prepare(replacement)) !== scheduleKey(replacement))) decision = "conflict"
        return decision === "upload" ? replacement : undefined
      })
      if (stopped) return
      if (decision === "conflict") {
        options.status("conflict", { local: options.read(), remote: exchange.before })
        return
      }
      const copy = decision === "download" ? exchange.before : exchange.after
      if (!copy) throw new Error("לא נמצא עותק בגוגל. פתחו השוואה מעודכנת.")
      const accepted = await options.accept(local, copy, decision === "download" ? "download" : chosen?.choice === "merge" ? "merge" : false, () => !stopped)
        .catch((error: unknown) => { throw new LocalSyncSaveError(decision === "upload", error) })
      if (stopped) return
      if (!accepted) { options.status("pending"); queued = true }
      else options.status("synced")
    } catch (error) {
      if (!stopped) {
        if (error instanceof CloudScheduleError || error instanceof LocalSyncSaveError || (error as { code?: string })?.code === "invalid-argument") blockedVersion = attempted
        options.status("error", undefined, error)
        if (blockedVersion === undefined) schedule(30000)
      }
    } finally {
      busy = false
      if (queued) schedule()
    }
  }
  return {
    schedule,
    resolve: (review: SyncReview, choice: SyncChoice, merged?: PlanWorkspace) => {
      resolution = { review, choice, ...(merged ? { merged } : {}) }
      schedule(0)
    },
    stop: () => { stopped = true; clearTimeout(timer) },
  }
}
