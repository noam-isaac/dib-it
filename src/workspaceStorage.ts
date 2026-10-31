import { z } from "zod"
import { legacyWorkspaceKeys, MIGRATION_RECOVERY_KEY } from "./preferences"
import { decodeWorkspace, UnsupportedWorkspaceVersionError, workspaceVersion } from "./workspaceFormat"
import type { PlanWorkspace } from "./plans"

export type WorkspaceImportSource = { kind: "file" | "google"; raw: string }
type Source = { primary: string | null; legacy: Record<string, string>; receipt: string | null }
const workspaceKey = "Dib It"
const recoveryPackageSchema = z.strictObject({
  format: z.literal("dibit-migration-recovery"), version: z.literal(1), savedAt: z.number().finite(),
  storage: z.record(z.string(), z.string()),
  incoming: z.strictObject({ kind: z.enum(["file", "google"]), raw: z.string() }).optional(),
})
type RecoveryPackage = z.infer<typeof recoveryPackageSchema>
const journalSchema = z.strictObject({
  format: z.literal("dibit-migration-journal"), version: z.literal(1),
  committed: recoveryPackageSchema.nullable(),
  pending: z.strictObject({
    target: z.string().refine(raw => {
      try { const value: unknown = JSON.parse(raw); return workspaceVersion(value) === 1 && !!decodeWorkspace(value) }
      catch { return false }
    }),
    package: recoveryPackageSchema,
  }).optional(),
})
type RecoveryJournal = z.infer<typeof journalSchema>
const committedJournal = (committed: RecoveryPackage | null): RecoveryJournal => ({ format: "dibit-migration-journal", version: 1, committed })
const readRecoveryJournal = (): RecoveryJournal => {
  const raw = localStorage.getItem(MIGRATION_RECOVERY_KEY)
  if (raw === null) return committedJournal(null)
  const value: unknown = JSON.parse(raw)
  // Preserve recovery packages produced by the earlier draft without rewriting on read.
  const original = recoveryPackageSchema.safeParse(value)
  return original.success ? committedJournal(original.data) : journalSchema.parse(value)
}
const selectedRecovery = (journal: RecoveryJournal, primary: string | null) =>
  journal.pending?.target === primary ? journal.pending.package : journal.committed

/** Reading recovery is pure, including a crash after the primary commit but before promotion. */
export const getMigrationRecovery = () => selectedRecovery(readRecoveryJournal(), localStorage.getItem(workspaceKey))
const settleRecoveryJournal = (journal: RecoveryJournal, primary: string | null): RecoveryJournal => {
  if (!journal.pending) return journal
  const settled = committedJournal(selectedRecovery(journal, primary))
  // Must succeed before another primary write: otherwise an abandoned target could appear committed later.
  localStorage.setItem(MIGRATION_RECOVERY_KEY, JSON.stringify(settled))
  return settled
}
const captureSource = (): Source => ({
  primary: localStorage.getItem(workspaceKey),
  legacy: Object.fromEntries(legacyWorkspaceKeys().flatMap(key => {
    const raw = localStorage.getItem(key)
    return raw === null ? [] : [[key, raw]]
  })),
  receipt: localStorage.getItem("Dib It Sync"),
})
const sourceKey = (source: Source) => JSON.stringify([source.primary, Object.entries(source.legacy).sort(([a], [b]) => a.localeCompare(b)), source.receipt])

/** Historical multi-key schedules are interpreted in memory; all original strings remain available. */
const legacyWorkspace = (source: Record<string, string>) => {
  const value = (key: string): unknown => source[key] === undefined ? undefined : JSON.parse(source[key])
  const semester = source.Semester === undefined ? "" : z.string().parse(value("Semester"))
  const courseKeys = Object.keys(source).filter(key => /^Courses(?: \d{4}[ab])?$/.test(key)).sort()
  if (!courseKeys.length && Object.keys(source).some(key => /^(Groups|Colors)(?: \d{4}[ab])?$/.test(key)))
    throw new Error("נמצאו בחירות ישנות ללא רשימת הקורסים שלהן. הורידו עותק לשחזור לפני שינוי הנתונים.")
  const courses = courseKeys.map(key => {
    const term = key === "Courses" ? semester : key.slice("Courses ".length)
    const field = (name: string): unknown => {
      const dated = value(`${name} ${term}`), shared = key === "Courses" ? value(name) : undefined
      if (dated !== undefined && shared !== undefined && JSON.stringify(dated) !== JSON.stringify(shared))
        throw new Error("נמצאו בחירות סותרות בשני פורמטים ישנים. הורידו עותק לשחזור לפני שינוי הנתונים.")
      return dated ?? shared
    }
    const groups = z.record(z.string(), z.array(z.string())).parse(field("Groups") ?? {})
    const colors = z.record(z.string(), z.string()).parse(field("Colors") ?? {})
    return [term, z.array(z.string()).parse(value(key)).map(id => ({
      id, ...(groups[id] ? { groups: groups[id] } : {}), ...(colors[id] ? { color: colors[id] } : {}),
    }))] as const
  })
  // Two historical layouts may coexist, but neither may silently overwrite the other.
  if (new Set(courses.map(([term]) => term)).size !== courses.length)
    throw new Error("נמצאו שתי מערכות ישנות לאותו סמסטר. הורידו עותק לשחזור לפני שינוי הנתונים.")
  return {
    ...(source.Semester === undefined ? {} : { semester }),
    ...(courses.length ? { courses: Object.fromEntries(courses) } : {}),
    ...(source["School (Dib It Serialize)"] === undefined ? {} : { school: z.string().parse(value("School (Dib It Serialize)")) }),
    ...(source["Study Plan (Dib It Serialize)"] === undefined ? {} : { studyPlan: z.string().parse(value("Study Plan (Dib It Serialize)")) }),
  }
}

export const readWorkspace = (): PlanWorkspace => {
  const raw = localStorage.getItem(workspaceKey)
  return decodeWorkspace(raw === null ? legacyWorkspace(captureSource().legacy) : JSON.parse(raw))
}

/** One primary write commits the version; the recovery package is never an automatic rollback source. */
export const writeWorkspace = (workspace: PlanWorkspace, incoming?: WorkspaceImportSource) => {
  const prepared = decodeWorkspace(workspace)
  const source = captureSource()
  const currentVersion = (() => {
    if (source.primary === null) return undefined
    try {
      const value: unknown = JSON.parse(source.primary)
      const version = workspaceVersion(value)
      decodeWorkspace(value)
      return version
    }
    catch (error) {
      if (error instanceof UnsupportedWorkspaceVersionError) throw error
      // Explicit replacement can recover malformed data, but first preserves its exact bytes.
      return undefined
    }
  })()
  const incomingLegacy = incoming && workspaceVersion(JSON.parse(incoming.raw)) === 0
  const migration = (source.primary !== null && currentVersion !== 1) ||
    (source.primary === null && Object.keys(source.legacy).length > 0) || incomingLegacy
  const serialized = JSON.stringify(prepared)
  const previousJournal = readRecoveryJournal()
  // No replacement occurred, so an equivalent import must not rotate the last successful recovery copy.
  if (serialized === source.primary) return prepared
  const journal = settleRecoveryJournal(previousJournal, source.primary)
  let recovery: RecoveryPackage | undefined
  if (migration) {
    recovery = {
      format: "dibit-migration-recovery", version: 1, savedAt: Date.now(),
      storage: {
        ...(source.primary === null ? {} : { [workspaceKey]: source.primary }), ...source.legacy,
        ...(source.receipt === null ? {} : { "Dib It Sync": source.receipt }),
      },
      ...(incomingLegacy ? { incoming } : {}),
    }
    // Bounded journal: staging cannot erase the recovery copy from the previous successful migration.
    localStorage.setItem(MIGRATION_RECOVERY_KEY, JSON.stringify({ ...journal, pending: { target: serialized, package: recovery } }))
  }
  // ponytail: this observes intervening changes; simultaneous tabs still need transactional storage.
  if (sourceKey(captureSource()) !== sourceKey(source))
    throw new Error("הנתונים השתנו בזמן השמירה. השינוי לא נשמר; נסו שוב מול העותק המעודכן.")
  localStorage.setItem(workspaceKey, serialized)
  if (recovery) {
    // The primary commit already succeeded. A promotion failure leaves the matching pending copy readable.
    try { localStorage.setItem(MIGRATION_RECOVERY_KEY, JSON.stringify(committedJournal(recovery))) }
    catch { /* Every later writer must settle this journal before changing the primary again. */ }
  }
  window.dispatchEvent(new StorageEvent("storage", { key: workspaceKey, newValue: serialized }))
  // Delete only values this migration archived. Leftovers remain inactive and recoverable until reset.
  if (migration) Object.keys(source.legacy).forEach(key => {
    try { if (localStorage.getItem(key) === source.legacy[key]) localStorage.removeItem(key) } catch { /* The committed primary remains authoritative. */ }
  })
  return prepared
}

export const reportWorkspaceSaveError = (error: unknown) => {
  const detail = error instanceof UnsupportedWorkspaceVersionError ? error.message
    : "השינוי לא נשמר במכשיר. הנתונים הקודמים נשמרו; הורידו גיבוי ונסו שוב לאחר פינוי מקום בדפדפן."
  try { window.dispatchEvent(new CustomEvent<string>("workspace-save-error", { detail })) }
  catch { /* Reporting must not replace the original storage error. */ }
}
