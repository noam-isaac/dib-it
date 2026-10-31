import { doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore"
import { z } from "zod"
import { auth, firestore } from "./firebase"
import { assertCloudDocumentSize, CloudScheduleError, cloudScheduleData, readCloudSchedule, startScheduleSync, type CloudCopy, type SyncChoice, type SyncOptions, type SyncReview } from "./scheduleSync"
import { acceptGoogleCopy, readLocalCopy, StaleWorkspaceError } from "./localSchedule"
import { prepareWorkspace } from "./models"
import type { PlanWorkspace } from "./plans"
import { workspaceVersion } from "./workspaceFormat"

const envelope = z.strictObject({ protocol: z.literal(2), revision: z.number().int().positive(), savedAt: z.instanceof(Timestamp), workspace: z.unknown(), migrationOriginal: z.record(z.string(), z.unknown()).optional() })
const envelopeCore = ["protocol", "revision", "savedAt", "workspace"]
const envelopeFields = ["protocol", "revision", "savedAt", "workspace", "migrationOriginal"]
const isEnvelope = (data: unknown): data is Record<string, unknown> => !!data && typeof data === "object" &&
  Object.keys(data).includes("workspace") && (envelopeCore.every(key => Object.keys(data).includes(key)) ||
    Object.keys(data).every(key => envelopeFields.includes(key)))
export const readGoogleCopy = (data: unknown): CloudCopy | null => {
  if (data === undefined) return null
  workspaceVersion(data)
  if (isEnvelope(data)) {
    const result = envelope.safeParse(data)
    if (!result.success) throw new CloudScheduleError("העותק בגוגל פגום או בפורמט שאינו נתמך בגרסה זו של Dib It. עדכנו את האתר ונסו שוב. העותק בגוגל לא שונה.")
    const parsed = result.data
    const workspace = readCloudSchedule(parsed.workspace)
    if (!workspace) throw new Error("העותק בגוגל אינו מכיל מערכות שעות.")
    return { workspace, revision: parsed.revision, savedAt: parsed.savedAt.toMillis(), source: { kind: "google", raw: JSON.stringify(parsed.workspace) },
      ...(parsed.migrationOriginal === undefined ? {} : { migrationOriginal: parsed.migrationOriginal }) }
  }
  return { workspace: readCloudSchedule(data)!, revision: 0, savedAt: null, source: { kind: "google", raw: JSON.stringify(data) } }
}
export const googleReference = (uid: string) => doc(firestore!, "users", uid)
const requireAccount = (uid: string) => { if (auth?.currentUser?.uid !== uid) throw new Error("חשבון גוגל השתנה. פתחו שוב את ההשוואה.") }
export const fetchGoogleCopy = async (uid: string) => {
  const snapshot = await getDocFromServer(googleReference(uid))
  requireAccount(uid)
  return readGoogleCopy(snapshot.data())
}
export const exchangeGoogleCopy = (uid: string, decide: (remote: CloudCopy | null) => ReturnType<typeof cloudScheduleData> | undefined) =>
  runTransaction(firestore!, async transaction => {
    const reference = googleReference(uid)
    const snapshot = await transaction.get(reference)
    requireAccount(uid)
    const raw = snapshot.data()
    const before = readGoogleCopy(raw)
    const upload = decide(before)
    if (!upload) return { before, after: before }
    const workspace = cloudScheduleData(upload, uid, 92)
    const original = isEnvelope(raw) ? raw.workspace : raw
    const migrationOriginal = before?.migrationOriginal ?? (original && workspaceVersion(original) === 0 ? original : undefined)
    const revision = (before?.revision ?? 0) + 1
    const replacement = { protocol: 2, revision, workspace, ...(migrationOriginal === undefined ? {} : { migrationOriginal }) }
    // Count the complete envelope and untouched original using native Firestore value sizes.
    assertCloudDocumentSize({ ...replacement, savedAt: Timestamp.now() }, uid)
    transaction.set(reference, { ...replacement, savedAt: serverTimestamp() })
    // Unknown until a server snapshot arrives; never invent a cloud-save time.
    return { before, after: { workspace, revision, savedAt: null, source: before?.source,
      ...(migrationOriginal === undefined ? {} : { migrationOriginal }) } }
  })

export const googleSyncOptions = (uid: string, status: SyncOptions["status"], enabled: () => boolean = () => true): SyncOptions => ({
  uid, read: readLocalCopy, prepare: prepareWorkspace, status,
  exchange: decide => exchangeGoogleCopy(uid, remote => { if (!enabled()) throw new Error("הסנכרון האוטומטי כבוי."); return decide(remote) }),
  accept: async (expected, copy, apply, active) => acceptGoogleCopy(expected, uid, copy, apply, () => active() && enabled() && auth?.currentUser?.uid === uid),
})
export const loadSyncReview = async (uid: string): Promise<SyncReview> => {
  const remote = await fetchGoogleCopy(uid)
  const local = readLocalCopy()
  requireAccount(uid)
  return { local, remote }
}
export const commitSyncReview = (uid: string, review: SyncReview, choice: SyncChoice, merged?: PlanWorkspace) => new Promise<"synced" | "pending">((resolve, reject) => {
  const controller = startScheduleSync(googleSyncOptions(uid, (status, _review, error) => {
    if (status === "syncing" || status === "connecting") return
    controller.stop()
    if (status === "conflict") reject(new StaleWorkspaceError())
    else if (status === "error") reject(error)
    else resolve(status)
  }))
  controller.resolve(review, choice, merged)
})
