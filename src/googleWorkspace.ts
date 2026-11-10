import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore"
import { z } from "zod"
import { auth, firestore } from "./firebase"
import {
  assertCloudDocumentSize,
  CloudScheduleError,
  cloudScheduleData,
  readCloudSchedule,
  type CloudCopy,
  type SyncOptions,
} from "./scheduleSync"
import {
  acceptGoogleCopy,
  clearPendingUpload,
  readLocalCopy,
  recoverPendingUpload,
  rememberPendingUpload,
  retryPendingSyncReceipt,
} from "./localSchedule"
import { prepareWorkspace } from "./models"
import { workspaceVersion, withCatalogSourceOrder } from "./workspaceFormat"

const envelope = z.strictObject({
  protocol: z.union([z.literal(2), z.literal(3)]),
  catalogSources: z.array(z.string()).optional(),
  revision: z.number().int().positive(),
  savedAt: z.instanceof(Timestamp),
  workspace: z.unknown(),
  migrationOriginal: z.record(z.string(), z.unknown()).optional(),
})
const envelopeCore = ["protocol", "revision", "savedAt", "workspace"]
const envelopeFields = [
  "protocol",
  "revision",
  "savedAt",
  "workspace",
  "migrationOriginal",
  "catalogSources",
]
const isEnvelope = (data: unknown): data is Record<string, unknown> =>
  !!data &&
  typeof data === "object" &&
  Object.keys(data).includes("workspace") &&
  (envelopeCore.every((key) => Object.keys(data).includes(key)) ||
    Object.keys(data).every((key) => envelopeFields.includes(key)))
export const readGoogleCopy = (data: unknown): CloudCopy | null => {
  if (data === undefined) return null
  workspaceVersion(data)
  if (isEnvelope(data)) {
    const result = envelope.safeParse(data)
    if (!result.success)
      throw new CloudScheduleError(
        "העותק בגוגל פגום או בפורמט שאינו נתמך בגרסה זו של Dib It. עדכנו את האתר ונסו שוב. העותק בגוגל לא שונה.",
      )
    const parsed = result.data
    const decoded = readCloudSchedule(parsed.workspace)
    if (!decoded) throw new Error("העותק בגוגל אינו מכיל מערכות שעות.")
    if ((parsed.protocol === 3) !== (parsed.catalogSources !== undefined))
      throw new CloudScheduleError(
        "פורמט הסנכרון בגוגל אינו תקין. הנתונים לא שונו.",
      )
    const workspace = parsed.catalogSources
      ? withCatalogSourceOrder(decoded, parsed.catalogSources)
      : decoded
    return {
      workspace,
      revision: parsed.revision,
      savedAt: parsed.savedAt.toMillis(),
      source: { kind: "google", raw: JSON.stringify(parsed.workspace) },
      ...(parsed.migrationOriginal === undefined
        ? {}
        : { migrationOriginal: parsed.migrationOriginal }),
    }
  }
  return {
    workspace: readCloudSchedule(data)!,
    revision: 0,
    savedAt: null,
    source: { kind: "google", raw: JSON.stringify(data) },
  }
}
export const googleReference = (uid: string) => doc(firestore!, "users", uid)
export const watchGoogleCopy = (
  uid: string,
  receive: (copy: CloudCopy | null) => void,
  failed: (error: Error) => void,
) => {
  let stopped = false
  let disconnected = false
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const failure = (error: Error) => {
    if (stopped) return
    disconnected = true
    failed(error)
    clearTimeout(timer)
    timer = setTimeout(listen, 30000)
  }
  const listen = () => {
    if (stopped) return
    clearTimeout(timer)
    unsubscribe?.()
    unsubscribe = onSnapshot(
      googleReference(uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
          return
        try {
          const copy = readGoogleCopy(snapshot.data())
          disconnected = false
          clearTimeout(timer)
          receive(copy)
        } catch (error) {
          failure(
            error instanceof Error
              ? error
              : new Error("קריאת העותק בגוגל נכשלה."),
          )
        }
      },
      failure,
    )
  }
  const resume = () => {
    if (disconnected) listen()
  }
  listen()
  window.addEventListener("online", resume)
  window.addEventListener("focus", resume)
  return () => {
    stopped = true
    clearTimeout(timer)
    unsubscribe?.()
    window.removeEventListener("online", resume)
    window.removeEventListener("focus", resume)
  }
}
const requireAccount = (uid: string) => {
  if (auth?.currentUser?.uid !== uid)
    throw new Error("חשבון גוגל השתנה. הסנכרון ימשיך בחשבון המחובר.")
}
export const exchangeGoogleCopy = async (
  uid: string,
  decide: (
    remote: CloudCopy | null,
  ) => ReturnType<typeof cloudScheduleData> | undefined,
  enabled: () => boolean = () => true,
) => {
  const requireEnabled = () => {
    requireAccount(uid)
    if (!enabled()) throw new Error("הסנכרון האוטומטי כבוי.")
  }
  const result = await runTransaction(firestore!, async (transaction) => {
    const reference = googleReference(uid)
    const snapshot = await transaction.get(reference)
    requireEnabled()
    const raw = snapshot.data()
    const before = readGoogleCopy(raw)
    const needsConfirmation = await recoverPendingUpload(uid, before)
    requireEnabled()
    const upload = decide(before)
    if (!upload && (!needsConfirmation || !before))
      return { before, after: before, confirmedPendingOnly: false }
    // A no-op commit fences off an older uncertain write. Reading the old
    // revision alone cannot prove that a delayed request will not still arrive.
    const workspace = cloudScheduleData(upload ?? before!.workspace, uid, 92)
    const original = isEnvelope(raw) ? raw.workspace : raw
    const migrationOriginal =
      before?.migrationOriginal ??
      (original && workspaceVersion(original) === 0 ? original : undefined)
    const revision = (before?.revision ?? 0) + 1
    const replacement = {
      protocol: 3,
      catalogSources: Object.keys(workspace.customCourses ?? {}),
      revision,
      workspace,
      ...(migrationOriginal === undefined ? {} : { migrationOriginal }),
    }
    // Count the complete envelope and untouched original using native Firestore value sizes.
    assertCloudDocumentSize({ ...replacement, savedAt: Timestamp.now() }, uid)
    if (upload) await rememberPendingUpload(uid, before, workspace)
    requireEnabled()
    transaction.set(reference, { ...replacement, savedAt: serverTimestamp() })
    // Unknown until a server snapshot arrives; never invent a cloud-save time.
    return {
      before,
      confirmedPendingOnly: !upload,
      after: {
        workspace,
        revision,
        savedAt: null,
        source: before?.source,
        ...(migrationOriginal === undefined ? {} : { migrationOriginal }),
      },
    }
  })
  if (result.confirmedPendingOnly) clearPendingUpload(uid)
  return { before: result.before, after: result.after }
}

const readReadyLocalCopy = () => {
  retryPendingSyncReceipt()
  return readLocalCopy()
}

export const googleSyncOptions = (
  uid: string,
  status: SyncOptions["status"],
  enabled: () => boolean = () => true,
): SyncOptions => ({
  uid,
  read: readReadyLocalCopy,
  prepare: prepareWorkspace,
  status,
  exchange: (decide) => exchangeGoogleCopy(uid, decide, enabled),
  accept: async (expected, copy, apply, active) =>
    acceptGoogleCopy(
      expected,
      uid,
      copy,
      apply,
      // Receipt-only completion cannot replace user data, and has its own newer-receipt guard.
      () =>
        !apply ||
        apply === "deferred-merge" ||
        (active() && enabled() && auth?.currentUser?.uid === uid),
    ),
})
