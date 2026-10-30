import { doc, getDocFromServer, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore"
import { z } from "zod"
import { auth, firestore } from "./firebase"
import { cloudScheduleData, readCloudSchedule, startScheduleSync, type CloudCopy, type SyncChoice, type SyncOptions, type SyncReview } from "./scheduleSync"
import { acceptGoogleCopy, readLocalCopy, StaleWorkspaceError } from "./localSchedule"
import { prepareWorkspace } from "./models"
import type { PlanWorkspace } from "./plans"
import { isScheduleBackup } from "./scheduleBackup"

const envelope = z.object({ protocol: z.literal(2), revision: z.number().int().positive(), savedAt: z.instanceof(Timestamp), workspace: z.unknown() })
export const readGoogleCopy = (data: unknown): CloudCopy | null => {
  if (data === undefined) return null
  if (!isScheduleBackup(data)) {
    const parsed = envelope.parse(data)
    const workspace = readCloudSchedule(parsed.workspace)
    if (!workspace) throw new Error("העותק בגוגל אינו מכיל מערכות שעות.")
    return { workspace, revision: parsed.revision, savedAt: parsed.savedAt.toMillis() }
  }
  return { workspace: readCloudSchedule(data)!, revision: 0, savedAt: null }
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
    const before = readGoogleCopy(snapshot.data())
    const upload = decide(before)
    if (!upload) return { before, after: before }
    // Envelope map/field overhead, beyond the existing workspace/document estimate.
    const workspace = cloudScheduleData(upload, uid, 92)
    const revision = (before?.revision ?? 0) + 1
    transaction.set(reference, { protocol: 2, revision, savedAt: serverTimestamp(), workspace })
    // Unknown until a server snapshot arrives; never invent a cloud-save time.
    return { before, after: { workspace, revision, savedAt: null } }
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
