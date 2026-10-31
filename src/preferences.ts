/**
 * The localStorage keys this application owns.
 *
 * The workspace keys and historical keys selected below hold user data: the saved
 * schedules, and the pointer tying them to a Google account. Recovery must never clear
 * them except through its own explicit confirmation. Everything in `PREFERENCE_KEYS`
 * is a display choice or a rebuildable cache, so discarding one costs the user nothing,
 * while leaving the app unusable costs them everything. Keys outside these selections
 * belong to something else on this origin and are never touched.
 */
export const MIGRATION_RECOVERY_KEY = "Dib It Migration Recovery"
export const WORKSPACE_KEYS = ["Dib It", "Dib It Sync", "Dib It Updated", MIGRATION_RECOVERY_KEY] as const

/** The two historical layouts: shared keys, or course/group/color keys per semester. */
export const legacyWorkspaceKeys = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
  .filter((key): key is string => key !== null && (
    /^(Courses|Groups|Colors)(?: \d{4}[ab])?$/.test(key) || key === "Semester" ||
    /^(School|Study Plan|Taken Courses) \(Dib It Serialize\)$/.test(key)
  ))

/** Keep modern-only backups byte-for-byte; legacy or mixed data needs its original strings. */
export const recoveryData = () => {
  const modern = localStorage.getItem("Dib It")
  const legacy = legacyWorkspaceKeys()
  const migration = localStorage.getItem(MIGRATION_RECOVERY_KEY)
  return legacy.length || migration !== null ? JSON.stringify({
    format: "dibit-storage-recovery", version: 1,
    storage: Object.fromEntries([...(modern === null ? [] : ["Dib It"]), ...legacy, ...(migration === null ? [] : [MIGRATION_RECOVERY_KEY])]
      .map(key => [key, localStorage.getItem(key)])),
  }) : modern ?? "{}"
}

/** Called only after the user confirms deleting local schedules. */
export const resetWorkspace = () => {
  // Fail before deleting any workspace data if automatic downloads cannot be disabled.
  localStorage.removeItem("Automatic Google Sync")
  ;[...legacyWorkspaceKeys(), ...WORKSPACE_KEYS.filter(key => key !== "Dib It"), "Hidden Tabs", "Dib It"].forEach(key => localStorage.removeItem(key))
}

export const PREFERENCE_KEYS = [
  "Hidden Tabs",
  "Compact View",
  "Sidebar Compact",
  "Automatic Google Sync",
  "Auto Bid Faculty Points",
  "Hide Taken Courses",
  "Study Plan Sorted",
  "Annual Course Registry",
  "Dib It Fork Intro Seen",
] as const

/** Clear display preferences and caches only. Schedules and unrelated storage are kept. */
export const resetPreferences = () => PREFERENCE_KEYS.map(key => {
  // Attempt every preference, but let recovery report a partial failure.
  try { localStorage.removeItem(key); return true }
  catch { return false }
}).every(Boolean)
