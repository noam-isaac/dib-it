import { z } from "zod"
import { getWorkspace, prepareWorkspace, setWorkspace } from "./models"
import { setLocalStorage } from "./hooks"
import {
  baseForAccount,
  reviewWorkspaceKey,
  scheduleKey,
  sameScheduleContent,
  readSyncBase,
  withLocalNavigation,
  UNAVAILABLE_SYNC_HISTORY,
  LocalSyncSaveError,
  type CloudCopy,
  type LocalCopy,
  type SyncApplication,
} from "./scheduleSync"
import { rememberWorkspaceTime, workspaceTime } from "./workspaceTime"
import { compareSchedules } from "./scheduleMerge"
import { PENDING_UPLOAD_KEY } from "./preferences"
import type { PlanWorkspace } from "./plans"

const pendingUploadsSchema = z.record(
  z.string(),
  z.object({
    receipt: z.string(),
    beforeRevision: z.number().int().nonnegative(),
    // Uploaded-content fingerprint -> exact local input, including retries at this revision.
    attempts: z.record(z.string(), z.string()),
  }),
)
const readPendingUploads = () =>
  pendingUploadsSchema.parse(
    JSON.parse(localStorage.getItem(PENDING_UPLOAD_KEY) ?? "{}"),
  )

export const clearPendingUpload = (uid: string) => {
  try {
    const pending = readPendingUploads()
    if (!pending[uid]) return
    const remaining = Object.fromEntries(
      Object.entries(pending).filter(([account]) => account !== uid),
    )
    if (Object.keys(remaining).length)
      localStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify(remaining))
    else localStorage.removeItem(PENDING_UPLOAD_KEY)
  } catch {
    // Leaving an acknowledged record is safe: its receipt fingerprint retires it on the next read.
  }
}

// Fingerprints avoid retaining a second copy of each proposed merged workspace.
const fingerprint = async (value: string | null) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")

export const rememberPendingUpload = async (
  uid: string,
  before: CloudCopy | null,
  upload: PlanWorkspace,
) => {
  try {
    const receipt = localStorage.getItem("Dib It Sync")
    const ancestor = scheduleKey(readLocalCopy().workspace)!
    const [receiptKey, uploadedKey] = await Promise.all([
      fingerprint(receipt),
      fingerprint(scheduleKey(upload)),
    ])
    if (receipt !== localStorage.getItem("Dib It Sync"))
      throw new Error("היסטוריית הסנכרון השתנתה בזמן הכנת השמירה. נסו שוב.")
    const pending = readPendingUploads()
    const previous = pending[uid]
    const beforeRevision = before?.revision ?? 0
    const attempts =
      previous?.receipt === receiptKey &&
      previous.beforeRevision === beforeRevision
        ? previous.attempts
        : {}
    localStorage.setItem(
      PENDING_UPLOAD_KEY,
      JSON.stringify({
        ...pending,
        [uid]: {
          receipt: receiptKey,
          beforeRevision,
          attempts: {
            ...attempts,
            [uploadedKey]: ancestor,
          },
        },
      }),
    )
  } catch (error) {
    // Abort before sending if the browser cannot retain the attempted write.
    throw new LocalSyncSaveError(false, error)
  }
}

/** Returns true when a confirming transaction write is needed to fence off an older attempt. */
export const recoverPendingUpload = async (
  uid: string,
  remote: CloudCopy | null,
): Promise<boolean> => {
  const pending = readPendingUploads()[uid]
  if (!pending) return false
  const receipt = localStorage.getItem("Dib It Sync")
  const [receiptKey, remoteKey] = await Promise.all([
    fingerprint(receipt),
    fingerprint(scheduleKey(remote?.workspace ?? null)),
  ])
  if (receipt !== localStorage.getItem("Dib It Sync"))
    return recoverPendingUpload(uid, remote)
  if (receiptKey !== pending.receipt) {
    clearPendingUpload(uid)
    return false
  }
  // An unchanged server version does not prove that a timed-out commit cannot still arrive.
  if (!remote || remote.revision <= pending.beforeRevision) return true

  try {
    const ancestor = pending.attempts[remoteKey]
    if (ancestor && readSyncBase(ancestor)) {
      writeSyncReceipt({
        uid,
        base: ancestor,
        revision: remote.revision,
        savedAt: remote.savedAt,
      })
    } else if (remote.revision !== pending.beforeRevision + 1) {
      // Multiple writes advanced the server, so an unacknowledged attempt may be among them.
      // Preserve both copies and require a choice instead of trusting the old baseline.
      writeSyncReceipt({ uid, base: UNAVAILABLE_SYNC_HISTORY })
    }
    // Exactly one revision with different contents proves another writer won.
    // Our old attempts cannot commit now; ordinary merging can use the original receipt.
    clearPendingUpload(uid)
    return false
  } catch (error) {
    throw new LocalSyncSaveError(false, error)
  }
}

const receiptSchema = z.object({
  uid: z.string(),
  base: z.string().nullable().optional(),
  revision: z.number().int().nonnegative().optional(),
  savedAt: z.number().nullable().optional(),
})
type SyncReceipt = z.infer<typeof receiptSchema>
let pendingReceipt:
  | { storage: Storage; raw: string | null; value: SyncReceipt }
  | undefined

const writeSyncReceipt = (value: SyncReceipt) => {
  try {
    if (localStorage.getItem("Dib It Sync") !== JSON.stringify(value))
      setLocalStorage("Dib It Sync", value, receiptSchema)
    pendingReceipt = undefined
    clearPendingUpload(value.uid)
  } catch (error) {
    // Keep the exact acknowledgement for a same-tab retry. A smaller safety marker
    // prevents a reload from trusting the old baseline when storage is full.
    try {
      setLocalStorage(
        "Dib It Sync",
        { uid: value.uid, base: UNAVAILABLE_SYNC_HISTORY },
        receiptSchema,
      )
    } catch {
      // Incoming replacements already have a durable safety marker. Upload-only
      // attempts retain their pre-send journal if this acknowledgement cannot save.
    }
    pendingReceipt = {
      storage: localStorage,
      raw: localStorage.getItem("Dib It Sync"),
      value,
    }
    throw error
  }
}

export const retryPendingSyncReceipt = () => {
  const pending = pendingReceipt
  if (!pending) return
  // A reset, another account, or another completed acknowledgement supersedes this retry.
  if (
    pending.storage !== localStorage ||
    pending.raw !== localStorage.getItem("Dib It Sync")
  ) {
    pendingReceipt = undefined
    return
  }
  try {
    writeSyncReceipt(pending.value)
  } catch (error) {
    throw new LocalSyncSaveError(false, error)
  }
}
export const readLocalCopy = (): LocalCopy => {
  const workspace = getWorkspace()
  const raw = localStorage.getItem("Dib It Sync")
  const sync = (() => {
    try {
      return receiptSchema.parse(JSON.parse(raw ?? "null"))
    } catch {
      return undefined
    }
  })()

  return {
    workspace,
    sync,
    historyUnavailable: raw !== null && !sync,
    version: reviewWorkspaceKey(workspace),
    time: workspaceTime(workspace),
  }
}

/** ponytail: best-effort recheck after the network response; concurrent local-tab guarantees need transactional storage. */
export const acceptGoogleCopy = (
  expected: LocalCopy,
  uid: string,
  copy: CloudCopy,
  apply: SyncApplication,
  active: () => boolean,
) => {
  if (!active()) throw new Error("הסנכרון הופסק. הנתונים במכשיר לא הוחלפו.")
  // An applied copy may only be waiting for its receipt. Settle that first so
  // a deferred-merge fallback cannot replace its acknowledgement with older ancestry.
  retryPendingSyncReceipt()
  const current = readLocalCopy()
  const deferredMerge = apply === "deferred-merge"
  // A stopped merge has not been applied. Its exact local input is the ancestor
  // for combining later local edits with the committed result on the next sync.
  const content = scheduleKey(
    deferredMerge ? expected.workspace : copy.workspace,
  )

  // A completed upload is a shared baseline even if another local edit is waiting.
  // Downloads require unchanged content; automatic and approved merges recheck newer edits below.
  if (
    current.version !== expected.version &&
    ((apply && apply !== "auto-merge" && !deferredMerge) ||
      current.historyUnavailable)
  ) {
    return false
  }

  // Timestamp completion is harmless. Another acknowledgement must never be rolled back.
  const receiptChanged =
    current.sync?.uid !== expected.sync?.uid ||
    current.sync?.base !== expected.sync?.base ||
    current.sync?.revision !== expected.sync?.revision ||
    current.historyUnavailable !== expected.historyUnavailable
  if (receiptChanged) {
    return (
      current.sync?.uid === uid &&
      (current.sync.revision ?? 0) >= copy.revision &&
      baseForAccount(current, uid) === content &&
      current.version === reviewWorkspaceKey(copy.workspace)
    )
  }

  const sameReceipt =
    current.sync?.uid === uid &&
    current.sync.revision === copy.revision &&
    baseForAccount(current, uid) === content
  const savedAt =
    copy.savedAt ?? (sameReceipt ? (current.sync?.savedAt ?? null) : null)

  if (apply && !deferredMerge) {
    // Edits made while an automatic merge was saving can still be independent.
    // Rebase them against the exact local input; a real collision leaves both copies intact.
    const workspace =
      apply === "auto-merge" && current.version !== expected.version
        ? compareSchedules(
            expected.workspace,
            current.workspace,
            copy.workspace,
          ).workspace
        : copy.workspace
    if (!workspace) return false
    const replacement = withLocalNavigation(workspace, current.workspace)

    // A different active plan/year must not reconcile an approved merge into unseen content.
    if (
      apply !== "download" &&
      scheduleKey(prepareWorkspace(replacement)) !== scheduleKey(workspace)
    ) {
      return false
    }

    const previousReceipt = localStorage.getItem("Dib It Sync")
    const previousWorkspace = localStorage.getItem("Dib It")
    const applying = JSON.stringify({ uid, base: UNAVAILABLE_SYNC_HISTORY })
    // Persist uncertainty before replacing data. A reload must never interpret
    // an applied-then-undone merge as an upload that has not been applied yet.
    localStorage.setItem("Dib It Sync", applying)
    try {
      setWorkspace(replacement, copy.source)
    } catch (error) {
      // Restore history only when the primary bytes prove replacement did not happen.
      // If restoration also fails, the durable marker keeps both copies protected.
      try {
        if (
          localStorage.getItem("Dib It") === previousWorkspace &&
          localStorage.getItem("Dib It Sync") === applying
        ) {
          if (previousReceipt === null) localStorage.removeItem("Dib It Sync")
          else localStorage.setItem("Dib It Sync", previousReceipt)
        }
      } catch {
        /* Leave the safety marker for recovery. */
      }
      throw error
    }
    if (scheduleKey(getWorkspace()) === scheduleKey(workspace)) {
      rememberWorkspaceTime(
        workspace,
        apply === "download" ? savedAt : Date.now(),
        apply === "download" ? "google" : "device",
      )
    }
  }

  // Write the receipt last. A receipt failure cannot claim an unapplied download was accepted.
  writeSyncReceipt({
    uid,
    base: content,
    revision: copy.revision,
    savedAt,
  })
  return sameScheduleContent(getWorkspace(), copy.workspace)
}
