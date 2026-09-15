import { Button, Stack, Text } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { useEffect } from "react"
import { z } from "zod"
import { getWorkspace } from "./models"

const noticeId = "app-update"
const reloadKey = "Dib It Update Attempt"
const resumeKey = "Dib It Update Resume"
const prepareEvent = "dibit:prepare-update"
const versionSchema = z.object({ version: z.string().uuid() })
const resumeSchema = z.object({
  kind: z.enum(["registration", "image"]),
  planId: z.string().min(1),
  semester: z.string().regex(/^\d{4}[ab]$/),
  studentName: z.string().max(100).optional(),
  studentId: z.string().max(9).optional(),
})
export type UpdateResume = z.infer<typeof resumeSchema>

export const clearUpdateResume = () => {
  try { sessionStorage.removeItem(resumeKey) } catch { /* Storage may be disabled. */ }
}
export const readUpdateResume = (): UpdateResume | null => {
  try {
    const result = resumeSchema.safeParse(JSON.parse(sessionStorage.getItem(resumeKey) ?? "null") as unknown)
    if (result.success) return result.data
  } catch { /* Ignore a malformed or inaccessible recovery draft. */ }
  clearUpdateResume()
  return null
}

/** Save only immediately before an update, and refuse the reload if saving fails. */
export const useUpdateResume = (value: UpdateResume, busy: boolean) => {
  useEffect(() => {
    const save = (event: Event) => {
      if (busy) { event.preventDefault(); return }
      try { sessionStorage.setItem(resumeKey, JSON.stringify(resumeSchema.parse(value))) }
      catch { event.preventDefault() }
    }
    window.addEventListener(prepareEvent, save)
    return () => window.removeEventListener(prepareEvent, save)
  }, [value, busy])
}

const importErrors = new WeakSet<object>()
export const isUpdateLoadError = (error: unknown) =>
  typeof error === "object" && error !== null && importErrors.has(error)

let checking = false
let reloading = false
let assetFailed = false

const hasUnfinishedInput = () => [...document.querySelectorAll("input, textarea, [contenteditable=true]")]
  .filter(element => !element.closest("[data-update-resumable], [data-update-persisted]"))
  .some(element =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? !element.disabled && !element.readOnly && !["hidden", "checkbox", "radio", "file"].includes(element.type) && !!element.value
      : !!element.textContent)
const hasUnfinishedWork = () => !!document.querySelector('[role="dialog"], [aria-busy="true"], [data-loading="true"]') ||
  !!document.activeElement?.matches('input:not([readonly]), textarea, [contenteditable="true"]') || hasUnfinishedInput()

const showUpdate = (message: string, retry = false) => {
  const options = {
    id: noticeId, title: retry ? "לא ניתן להשלים את הטעינה" : "גרסה חדשה זמינה",
    autoClose: false as const, withCloseButton: true, style: { direction: "rtl" as const },
    message: <Stack gap="xs">
      <Text size="sm">{message}</Text>
      <Button size="compact-sm" onClick={() => { void checkForUpdate(true) }}>
        {retry ? "בדיקה וניסיון נוסף" : "עדכון והמשך"}
      </Button>
    </Stack>,
  }
  // A stable ID prevents repeated failed clicks from stacking notifications.
  notifications.show(options)
  notifications.update(options)
}

const reload = (version: string) => {
  // Other dialogs may contain unsaved edits that this update flow cannot restore.
  if (hasUnfinishedInput() || [...document.querySelectorAll('[role="dialog"]')].some(dialog => !dialog.querySelector("[data-update-resumable]"))) {
    showUpdate("סיימו את העריכה או החיפוש וסגרו חלונות פתוחים, ואז בחרו בעדכון.")
    return
  }
  try {
    getWorkspace() // Validate the persisted schedule before leaving this page.
    if (sessionStorage.getItem(reloadKey) === version) {
      showUpdate("הטעינה עדיין לא הצליחה אחרי הרענון. הפרטים נשארו כאן. אם החיבור תקין, נסו לרענן ידנית.", true)
      return
    }
    if (!window.dispatchEvent(new Event(prepareEvent, { cancelable: true }))) {
      showUpdate("העדכון ממתין לסיום הפעולה או לשמירת הטופס בלשונית. הפרטים נשארו כאן.")
      return
    }
    sessionStorage.setItem(reloadKey, version)
    reloading = true
    window.location.reload()
  } catch {
    showUpdate("לא ניתן לשמור את המצב לרענון בטוח. הפרטים נשארו כאן; שמרו את העבודה לפני רענון ידני.")
  }
}

async function checkForUpdate(accepted = false) {
  if (!import.meta.env.PROD || checking || reloading) return
  checking = true
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json`, {
      cache: "no-store", signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error("Version unavailable")
    const { version } = versionSchema.parse(await response.json() as unknown)
    if (version === __APP_VERSION__ && !assetFailed) return
    if (!accepted && hasUnfinishedWork()) {
      showUpdate("אפשר לרענן את האתר ולהמשיך. טופס הרישום ישוחזר לאחר הרענון; פעולה אחרת יש לסיים תחילה.", version === __APP_VERSION__)
      return
    }
    reload(version)
  } catch {
    // Background checks stay quiet offline; a failed user action gets one useful message.
    if (assetFailed || accepted) showUpdate("לא ניתן לטעון את הקבצים הדרושים. בדקו את החיבור ונסו שוב; הפרטים נשארו כאן.", true)
  } finally { checking = false }
}

export const recoverAssetLoad = () => {
  assetFailed = true
  void checkForUpdate()
}

export const completeAssetLoad = () => {
  if (assetFailed) notifications.hide(noticeId)
  assetFailed = false
}

export const startAppUpdates = () => {
  if (!import.meta.env.PROD) return undefined
  const failed = (event: Event) => {
    if ("payload" in event && typeof event.payload === "object" && event.payload !== null) importErrors.add(event.payload)
    // Let the original rejection reach the caller, which skips its generic error notice.
    recoverAssetLoad()
  }
  const visible = () => { if (document.visibilityState === "visible") void checkForUpdate() }
  window.addEventListener("vite:preloadError", failed)
  document.addEventListener("visibilitychange", visible)
  window.addEventListener("focus", visible)
  return () => {
    window.removeEventListener("vite:preloadError", failed)
    document.removeEventListener("visibilitychange", visible)
    window.removeEventListener("focus", visible)
  }
}
