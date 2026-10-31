import { z } from "zod"
import type { PlanWorkspace } from "./plans"
import { scheduleKey } from "./scheduleSync"

const key = "Dib It Updated"
const schema = z.object({ content: z.string(), at: z.number().finite(), source: z.enum(["device", "google"]) })
export const workspaceTime = (workspace: PlanWorkspace) => {
  try {
    const saved = schema.parse(JSON.parse(localStorage.getItem(key) ?? "null"))
    return saved.content === scheduleKey(workspace) ? { at: saved.at, source: saved.source } : null
  } catch { return null }
}
export const rememberWorkspaceTime = (workspace: PlanWorkspace, at: number | null, source: "device" | "google") => {
  // Optional display metadata must never turn a successful schedule save into a failure.
  try {
    if (at === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify({ content: scheduleKey(workspace), at, source }))
  } catch { /* A missing/mismatched timestamp is displayed as unknown. */ }
}
