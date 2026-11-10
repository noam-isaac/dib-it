import { normalizePlans, type PlanWorkspace } from "./plans"
import { z } from "zod"
import { readScheduleBackup } from "./scheduleBackup"
import {
  compareSchedules,
  catalogContents,
  recheckScheduleChoices,
  type MergeChoice,
} from "./scheduleMerge"
import {
  decodeWorkspace,
  normalizeGroupSelections,
  workspaceContent,
  withCatalogSourceOrder,
} from "./workspaceFormat"
import {
  Bytes,
  DocumentReference,
  GeoPoint,
  Timestamp,
  VectorValue,
} from "firebase/firestore"

export class CloudScheduleError extends Error {}
export class LocalSyncSaveError extends Error {
  constructor(
    uploaded: boolean,
    readonly cause: unknown,
  ) {
    super(
      uploaded
        ? "העותק נשמר בגוגל, אך השלמת הסנכרון במכשיר נכשלה. הורידו גיבוי לקובץ לפני ניסיון נוסף."
        : "השלמת הסנכרון במכשיר נכשלה. הורידו גיבוי לקובץ לפני ניסיון נוסף.",
    )
  }
}

const bytes = (text: string) => new TextEncoder().encode(text).length + 1
const invalidCloudData = () => {
  throw new CloudScheduleError(
    "מבנה הנתונים אינו מתאים לשמירה בגוגל. הנתונים נשמרו במכשיר ואפשר להוריד גיבוי לקובץ.",
  )
}
const cloudTooLarge = () => {
  throw new CloudScheduleError(
    "הנתונים והעותק המקורי לשחזור חורגים ממגבלת השמירה בגוגל (1 MiB). העותק בגוגל לא הוחלף. הורידו גיבויים והקטינו קטלוגים אישיים או מערכות שמורות לפני ניסיון נוסף.",
  )
}
/** Includes native values in the untouched migration original: https://firebase.google.com/docs/firestore/storage-size */
const cloudValueSize = (value: unknown, depth = 0): number => {
  if (value === null || typeof value === "boolean") return 1
  if (typeof value === "number") return 8
  if (value instanceof Timestamp || value instanceof Date) return 8
  if (value instanceof GeoPoint) return 16
  if (value instanceof Bytes) {
    const length = value.toUint8Array().byteLength
    return length > 1048487 ? cloudTooLarge() : length
  }
  if (value instanceof VectorValue) return value.toArray().length * 8
  if (value instanceof DocumentReference)
    return value.path
      .split("/")
      .reduce((total, item) => total + bytes(item), 16)
  if (typeof value === "string") {
    if (bytes(value) > 1048487) return cloudTooLarge()
    return bytes(value)
  }
  if (depth > 20) return invalidCloudData()
  if (Array.isArray(value))
    return (value as unknown[]).reduce<number>((total, item) => {
      if (Array.isArray(item)) invalidCloudData()
      return total + cloudValueSize(item, depth + 1)
    }, 0)
  if (!value || typeof value !== "object") return invalidCloudData()
  return (
    32 +
    Object.entries(value).reduce((total, [key, item]) => {
      if (bytes(key) - 1 > 1500 || /^__.*__$/.test(key)) invalidCloudData()
      return total + bytes(key) + cloudValueSize(item, depth + 1)
    }, 0)
  )
}
export const assertCloudDocumentSize = (
  data: unknown,
  uid: string,
  overhead = 0,
) => {
  if (
    cloudValueSize(data) + bytes("users") + bytes(uid) + 16 + overhead >
    1048576
  )
    cloudTooLarge()
}
export const cloudScheduleData = (
  workspace: PlanWorkspace,
  uid: string,
  overhead = 0,
): PlanWorkspace => {
  let data: PlanWorkspace
  try {
    data = decodeWorkspace(JSON.parse(JSON.stringify(workspace)) as unknown)
  } catch {
    return invalidCloudData()
  }
  assertCloudDocumentSize(data, uid, overhead)
  return data
}

export const readCloudSchedule = (data: unknown): PlanWorkspace | null => {
  if (data === undefined) return null
  return readScheduleBackup(data)
}

// Firestore does not preserve object-key order. Only authoritative content participates in sync.
const serialized = (data: unknown) =>
  JSON.stringify(data, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, (value as Record<string, unknown>)[key]]),
        )
      : value,
  )
export const scheduleKey = (workspace: PlanWorkspace | null): string | null => {
  if (!workspace) return null
  const decoded = decodeWorkspace(workspace)
  return serialized([
    workspaceContent(decoded),
    Object.keys(decoded.customCourses ?? {}),
  ])
}

// Receipts retain source order for reconstruction; equality uses the effective
// definitions as well as every source's contents, just like merge comparisons.
export const sameScheduleContent = (
  left: PlanWorkspace,
  right: PlanWorkspace,
) => {
  const comparable = (workspace: PlanWorkspace) => {
    const decoded = decodeWorkspace(workspace)
    return serialized({
      ...workspaceContent(decoded),
      customCourses: catalogContents(decoded.customCourses),
    })
  }
  return comparable(left) === comparable(right)
}

export const UNAVAILABLE_SYNC_HISTORY = "history-unavailable"
/** Old keys omitted active navigation. No substantive migration may depend on that missing identity. */
export const readSyncBase = (
  key: string | null | undefined,
): PlanWorkspace | undefined => {
  if (!key) return undefined
  try {
    const raw: unknown = JSON.parse(key)
    const [value, sources] = Array.isArray(raw)
      ? z
          .tuple([z.record(z.string(), z.unknown()), z.array(z.string())])
          .parse(raw)
      : [z.record(z.string(), z.unknown()).parse(raw), undefined]
    const plans = value?.plans
    const activePlanId = Array.isArray(plans)
      ? (plans[0] as { id?: unknown } | undefined)?.id
      : undefined
    const workspace = readScheduleBackup(
      Array.isArray(plans) ? { ...value, activePlanId } : value,
    )
    if (sources) return withCatalogSourceOrder(workspace, sources)
    // Older receipts sorted away precedence. Trust them only when the sources
    // cannot disagree about a course's definition; equal current copies still sync directly.
    const definitions = Object.values(workspace.customCourses ?? {}).flatMap(
      Object.entries,
    )
    const winners = Object.fromEntries(definitions)
    return definitions.some(
      ([id, course]) => serialized(course) !== serialized(winners[id]),
    )
      ? undefined
      : workspace
  } catch {
    return undefined
  }
}
const interpretedBase = (key: string | null | undefined) =>
  key == null
    ? key
    : (scheduleKey(readSyncBase(key) ?? null) ?? UNAVAILABLE_SYNC_HISTORY)

export type SyncDecision = "equal" | "upload" | "download" | "conflict"
export const syncDecision = (
  local: PlanWorkspace,
  remote: PlanWorkspace | null,
  base: string | null | undefined,
): SyncDecision => {
  const localKey = scheduleKey(local)
  const remoteKey = scheduleKey(remote)
  if (localKey === remoteKey || (remote && sameScheduleContent(local, remote)))
    return "equal"
  // History can only conflict with an existing copy; the transaction rechecks absence.
  if (!remote) return "upload"
  base = interpretedBase(base)
  if (base !== undefined) {
    if (localKey === base && remote) return "download"
    if (remoteKey === base) return "upload"
    return "conflict"
  }
  const empty = normalizePlans(local.plans[0]?.courses ? { courses: {} } : {})
  if (localKey === scheduleKey(empty)) return "download"
  return "conflict"
}

export const withLocalNavigation = (
  remote: PlanWorkspace,
  local: PlanWorkspace,
): PlanWorkspace => ({
  ...remote,
  semester: local.semester ?? remote.semester,
  tab: local.tab ?? remote.tab,
  activePlanId: remote.plans.some((plan) => plan.id === local.activePlanId)
    ? local.activePlanId
    : remote.activePlanId,
})

export type CloudCopy = {
  workspace: PlanWorkspace
  revision: number
  savedAt: number | null
  source?: { kind: "google"; raw: string } | undefined
  migrationOriginal?: unknown
}
export type LocalCopy = {
  workspace: PlanWorkspace
  version: string
  time: { at: number; source: "device" | "google" } | null
  sync?:
    | {
        uid: string
        base?: string | null | undefined
        revision?: number | undefined
        savedAt?: number | null | undefined
      }
    | undefined
  historyUnavailable?: boolean | undefined
}
export type SyncReview = {
  local: LocalCopy
  remote: CloudCopy | null
  choices?: Record<string, MergeChoice>
}
export type SyncStatus =
  | "connecting"
  | "syncing"
  | "synced"
  | "conflict"
  | "pending"
  | "error"
export type SyncChoice = "upload" | "download"
export type SyncApplication =
  | "download"
  | "auto-merge"
  | "deferred-merge"
  | false
// Reviews include archived fields and catalog precedence, but exclude navigation and sync metadata.
export const reviewWorkspaceKey = (workspace: PlanWorkspace | null): string => {
  if (!workspace) return serialized(null)
  const contents = normalizeGroupSelections(workspace)
  return serialized({
    ...contents,
    semester: undefined,
    tab: undefined,
    activePlanId: undefined,
    customCourses: catalogContents(contents.customCourses),
  })
}
export const cloudCopyKey = (copy: CloudCopy | null) =>
  reviewWorkspaceKey(copy?.workspace ?? null)
export const baseForAccount = (record: LocalCopy, uid: string) =>
  record.historyUnavailable
    ? UNAVAILABLE_SYNC_HISTORY
    : record.sync && record.sync.uid !== uid
      ? "different-account"
      : interpretedBase(record.sync?.base)
export type SyncOptions = {
  uid: string
  read: () => LocalCopy
  accept: (
    expected: LocalCopy,
    copy: CloudCopy,
    apply: SyncApplication,
    active: () => boolean,
  ) => Promise<boolean>
  exchange: (
    decide: (remote: CloudCopy | null) => PlanWorkspace | undefined,
  ) => Promise<{ before: CloudCopy | null; after: CloudCopy | null }>
  prepare: (workspace: PlanWorkspace) => PlanWorkspace
  status: (status: SyncStatus, review?: SyncReview, error?: unknown) => void
}

// Controllers in this tab share completion order, including acknowledgements after stopping.
// Other tabs still require transactional local storage for the deferred cross-tab guarantee.
const syncCompletions = new Map<string, Promise<void>>()

export const withScheduleSync = async <T>(
  uid: string,
  action: () => Promise<T>,
): Promise<T> => {
  const previous = syncCompletions.get(uid)
  let finish!: () => void
  const completion = new Promise<void>((resolve) => {
    finish = resolve
  })
  syncCompletions.set(uid, completion)
  try {
    await previous
    return await action()
  } finally {
    finish()
    if (syncCompletions.get(uid) === completion) syncCompletions.delete(uid)
  }
}

export const startScheduleSync = (options: SyncOptions) => {
  let stopped = false
  let busy = false
  let queued = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolution:
    | ({ review: SyncReview } & (
        | { choice: SyncChoice; choices?: never }
        | { choices: Record<string, MergeChoice>; choice?: never }
      ))
    | undefined
  let blockedVersion: string | undefined
  const retryVersion = (local: LocalCopy) =>
    JSON.stringify([local.version, local.sync, local.historyUnavailable])

  const schedule = (delay = 1000) => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      void run()
    }, delay)
  }
  const run = async () => {
    if (stopped) return
    if (busy) {
      queued = true
      return
    }
    busy = true
    queued = false
    const chosen = resolution
    resolution = undefined
    let attempted: string | undefined
    try {
      await withScheduleSync(options.uid, async () => {
        if (stopped) return
        let local = options.read()
        if (blockedVersion === retryVersion(local) && !chosen) return
        attempted = retryVersion(local)
        blockedVersion = undefined
        let decision = "equal" as SyncDecision
        let application: SyncApplication = false
        let retainedChoices: Record<string, MergeChoice> = {}
        options.status("syncing")
        const exchange = await options.exchange((remote) => {
          if (stopped) throw new Error("Sync stopped")

          // The read or a transaction retry can outlast another local edit or completed sync.
          local = options.read()
          attempted = retryVersion(local)
          application = false
          let replacement = local.workspace
          if (chosen && !chosen.choices) {
            const stale =
              local.version !== chosen.review.local.version ||
              cloudCopyKey(remote) !== cloudCopyKey(chosen.review.remote)
            if (stale) decision = "conflict"
            else decision = chosen.choice === "download" ? "download" : "upload"
          } else {
            decision = syncDecision(
              local.workspace,
              remote?.workspace ?? null,
              baseForAccount(local, options.uid),
            )
            if (decision === "conflict" && remote) {
              const base = readSyncBase(baseForAccount(local, options.uid))
              const previous = chosen?.review
              const comparison =
                chosen?.choices && previous?.remote
                  ? recheckScheduleChoices(
                      base,
                      local.workspace,
                      remote.workspace,
                      compareSchedules(
                        readSyncBase(
                          baseForAccount(previous.local, options.uid),
                        ),
                        previous.local.workspace,
                        previous.remote.workspace,
                        chosen.choices,
                      ).changes,
                      chosen.choices,
                    )
                  : {
                      ...compareSchedules(
                        base,
                        local.workspace,
                        remote.workspace,
                      ),
                      choices: {},
                    }
              retainedChoices = comparison.choices
              const merged = comparison.workspace
              // Catalog reconciliation must preserve every choice before an unseen merge can save.
              if (
                merged &&
                scheduleKey(options.prepare(merged)) === scheduleKey(merged)
              ) {
                replacement = merged
                decision = "upload"
                application = "auto-merge"
              }
            }
          }

          if (decision === "download") application = "download"
          return decision === "upload" ? replacement : undefined
        })
        if (stopped) {
          if (decision === "upload" && exchange.after) {
            // A committed write remains history even after sync is disabled. Never apply it here.
            await options.accept(
              local,
              exchange.after,
              application ? "deferred-merge" : false,
              () => true,
            )
          }
          return
        }
        if (decision === "conflict") {
          const latest = options.read()
          const changedWhileWaiting =
            latest.version !== local.version ||
            baseForAccount(latest, options.uid) !==
              baseForAccount(local, options.uid)
          if (!chosen && changedWhileWaiting) {
            queued = true
            options.status("pending")
            return
          }
          const review: SyncReview = {
            local,
            remote: exchange.before,
            choices: retainedChoices,
          }
          if (chosen?.choices && !resolution)
            resolution = { review, choices: retainedChoices }
          options.status("conflict", review)
          return
        }
        const copy = decision === "download" ? exchange.before : exchange.after
        if (!copy) throw new Error("לא נמצא עותק בגוגל. פתחו השוואה מעודכנת.")
        const accepted = await options
          .accept(local, copy, application, () => !stopped)
          .catch(async (error: unknown) => {
            if (decision === "upload" && application) {
              // The cloud commit is real even if applying it locally failed.
              // Preserve its ancestor before any retry can mistake a newer undo for unchanged data.
              try {
                await options.accept(local, copy, "deferred-merge", () => true)
              } catch {
                // The storage boundary retains failed receipts for a same-tab retry.
              }
            }
            throw new LocalSyncSaveError(decision === "upload", error)
          })
        if (!accepted && decision === "upload" && application) {
          // Google committed, but a newer local edit prevented application.
          // Keep that edit relative to the exact input, including an undo back
          // to the old baseline. A newer receipt makes this acknowledgement a no-op.
          await options.accept(local, copy, "deferred-merge", () => true)
        }
        if (stopped) return
        if (!accepted) {
          options.status("pending")
          queued = true
        } else options.status("synced")
      })
    } catch (error) {
      if (!stopped) {
        // A connection failure does not revoke an approved choice. Revalidate it
        // against fresh alternatives on retry; never replay an old workspace.
        if (chosen && !resolution) resolution = chosen
        if (
          error instanceof CloudScheduleError ||
          error instanceof LocalSyncSaveError ||
          (error as { code?: string })?.code === "invalid-argument"
        )
          blockedVersion = attempted
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
    retry: () => {
      blockedVersion = undefined
      schedule(0)
    },
    resolveChanges: (
      review: SyncReview,
      choices: Record<string, MergeChoice>,
    ) => {
      resolution = { review, choices }
      schedule(0)
    },
    resolve: (review: SyncReview, choice: SyncChoice) => {
      resolution = { review, choice }
      schedule(0)
    },
    stop: () => {
      stopped = true
      clearTimeout(timer)
    },
  }
}
