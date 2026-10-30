import { z } from "zod"
import { getWorkspace, setWorkspace } from "./models"
import { setLocalStorage } from "./hooks"
import { scheduleKey, withLocalNavigation, type CloudCopy, type LocalCopy } from "./scheduleSync"
import { rememberWorkspaceTime, workspaceTime } from "./workspaceTime"

const receiptSchema = z.object({ uid: z.string(), base: z.string().nullable().optional(), revision: z.number().int().nonnegative().optional(), savedAt: z.number().nullable().optional() })
export class StaleWorkspaceError extends Error {
  constructor() { super("הנתונים השתנו מאז שההשוואה נפתחה. פתחו השוואה מעודכנת לפני שמירה.") }
}
export const readLocalCopy = (): LocalCopy => {
  const workspace = getWorkspace()
  const raw = localStorage.getItem("Dib It Sync")
  const sync = (() => { try { return receiptSchema.parse(JSON.parse(raw ?? "null")) } catch { return undefined } })()
  return { workspace, sync, historyUnavailable: raw !== null && !sync, version: JSON.stringify([workspace, raw]), time: workspaceTime(workspace) }
}
/** ponytail: best-effort recheck after the network response; concurrent local-tab guarantees need transactional storage. */
export const acceptGoogleCopy = (expected: LocalCopy, uid: string, copy: CloudCopy, apply: "download" | "merge" | false, active: () => boolean) => {
  if (!active()) throw new Error("הסנכרון הופסק. הנתונים במכשיר לא הוחלפו.")
  const current = readLocalCopy()
  if (current.version !== expected.version) return false
  if (apply) {
    setWorkspace(withLocalNavigation(copy.workspace, current.workspace), copy.source)
    if (scheduleKey(getWorkspace()) === scheduleKey(copy.workspace))
      rememberWorkspaceTime(copy.workspace, apply === "merge" ? Date.now() : copy.savedAt, apply === "merge" ? "device" : "google")
  }
  // Write the receipt last. A receipt failure cannot claim an unapplied download was accepted.
  setLocalStorage("Dib It Sync", { uid, base: scheduleKey(copy.workspace), revision: copy.revision, savedAt: copy.savedAt }, receiptSchema)
  return scheduleKey(getWorkspace()) === scheduleKey(copy.workspace)
}
