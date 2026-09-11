/**
 * The localStorage keys this application owns.
 *
 * The workspace keys hold user data: the saved schedules, and the pointer tying them to a
 * Google account. Recovery must never clear them except through its own explicit
 * confirmation. Everything in `PREFERENCE_KEYS` is a display choice or a rebuildable cache,
 * so discarding one costs the user nothing, while leaving the app unusable costs them
 * everything. Keys outside both lists belong to something else on this origin and are
 * never touched.
 */
export const WORKSPACE_KEYS = ["Dib It", "Dib It Sync"] as const

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
export const resetPreferences = () => {
  for (const key of PREFERENCE_KEYS) {
    // Storage can be unavailable or full; a key that cannot be cleared must not
    // abort clearing the rest.
    try { localStorage.removeItem(key) } catch { /* Continue with the remaining keys. */ }
  }
}
