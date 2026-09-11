import { normalizePlans, type PlanWorkspace } from "./plans"
import { isScheduleBackup } from "./scheduleBackup"

export class CloudScheduleError extends Error {}

/** Size rules: https://firebase.google.com/docs/firestore/storage-size */
export const cloudScheduleData = (workspace: PlanWorkspace, uid: string): PlanWorkspace => {
  const bytes = (text: string) => new TextEncoder().encode(text).length + 1
  const invalid = () => { throw new CloudScheduleError("מבנה הנתונים אינו מתאים לגיבוי בגוגל. הנתונים נשמרו במכשיר ואפשר להוריד גיבוי לקובץ.") }
  const tooLarge = () => { throw new CloudScheduleError("הנתונים חורגים ממגבלת הגיבוי בגוגל (1 MiB). הנתונים נשמרו במכשיר ואפשר להוריד גיבוי לקובץ. הקטינו קטלוגים אישיים או מערכות שמורות לפני ניסיון נוסף.") }
  let data: PlanWorkspace
  try { data = JSON.parse(JSON.stringify(workspace)) }
  catch { return invalid() }
  const size = (value: unknown, depth = 0): number => {
    if (value === null || typeof value === "boolean") return 1
    if (typeof value === "number") return 8
    if (typeof value === "string") {
      if (bytes(value) > 1048487) return tooLarge()
      return bytes(value)
    }
    if (depth > 20) return invalid()
    if (Array.isArray(value)) return value.reduce((total, item) => {
      if (Array.isArray(item)) invalid()
      return total + size(item, depth + 1)
    }, 0)
    if (!value || typeof value !== "object") return invalid()
    return 32 + Object.entries(value).reduce((total, [key, item]) => {
      if (bytes(key) - 1 > 1500 || /^__.*__$/.test(key)) invalid()
      return total + bytes(key) + size(item, depth + 1)
    }, 0)
  }
  if (size(data) + bytes("users") + bytes(uid) + 16 > 1048576)
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
  return JSON.stringify(data, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)
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
  empty.plans[0].courses = local.plans[0].courses && {}
  if (localKey === scheduleKey(empty)) return "download"
  return "conflict"
}

export const withLocalNavigation = (remote: PlanWorkspace, local: PlanWorkspace): PlanWorkspace => ({
  ...remote,
  semester: local.semester ?? remote.semester,
  tab: local.tab ?? remote.tab,
  activePlanId: remote.plans.some(plan => plan.id === local.activePlanId) ? local.activePlanId : remote.activePlanId,
})

export type SyncStatus = "connecting" | "syncing" | "synced" | "conflict" | "error"

/** One serial queue for reads/writes; transactions protect against other devices. */
export const startScheduleSync = (options: {
  read: () => PlanWorkspace
  apply: (workspace: PlanWorkspace) => void
  base: () => string | null | undefined
  remember: (key: string | null) => void
  exchange: (decide: (remote: PlanWorkspace | null) => PlanWorkspace | undefined) => Promise<PlanWorkspace | null>
  status: (status: SyncStatus, remote?: PlanWorkspace | null, error?: unknown) => void
}) => {
  let stopped = false
  let busy = false
  let queued = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolution: { choice: "upload" | "download"; remoteKey: string | null } | undefined
  let blockedKey: string | null | undefined

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
    const choice = resolution
    resolution = undefined
    let attemptedKey: string | null | undefined
    try {
      const local = options.read()
      const localKey = scheduleKey(local)
      if (blockedKey !== undefined && blockedKey === localKey && !choice) return
      attemptedKey = localKey
      blockedKey = undefined
      const base = options.base()
      let decision = "equal" as SyncDecision
      options.status("syncing")
      const remote = await options.exchange(remote => {
        if (stopped) throw new Error("Sync stopped")
        decision = choice && choice.remoteKey === scheduleKey(remote)
          ? choice.choice : syncDecision(local, remote, base)
        return decision === "upload" ? local : undefined
      })
      if (stopped) return
      // A user can keep editing while the server responds. Never replace those edits.
      if (decision === "upload" || decision === "equal") options.remember(localKey)
      if (scheduleKey(options.read()) !== localKey) {
        queued = true
        return
      }
      if (decision === "download" && remote) {
        options.apply(withLocalNavigation(remote, options.read()))
        options.remember(scheduleKey(remote))
        queued = scheduleKey(options.read()) !== scheduleKey(remote)
      }
      options.status(decision === "conflict" ? "conflict" : "synced", remote)
    } catch (error) {
      if (!stopped) {
        options.status("error", undefined, error)
        // Local storage retains pending changes across offline periods and reloads.
        if (error instanceof CloudScheduleError || (error as { code?: string })?.code === "invalid-argument") blockedKey = attemptedKey
        else schedule(30000)
      }
    } finally {
      busy = false
      if (queued) schedule()
    }
  }
  return {
    schedule,
    resolve: (choice: "upload" | "download", remote: PlanWorkspace | null) => {
      resolution = { choice, remoteKey: scheduleKey(remote) }
      schedule(0)
    },
    stop: () => { stopped = true; clearTimeout(timer) },
  }
}
