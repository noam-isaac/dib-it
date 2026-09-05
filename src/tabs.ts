export const tabs = [
  { id: "schedule", label: "מערכת", icon: "calendar" },
  { id: "exams", label: "מבחנים", icon: "list-check" },
  { id: "study-plan", label: "תוכנית", icon: "table-list" },
  { id: "practice", label: "תרגול מבחנים", icon: "graduation-cap" },
  { id: "guide", label: "מדריך", icon: "info-circle" },
  { id: "settings", label: "הגדרות", icon: "gears" },
]

export const visibleTabs = (hiddenTabs: string[]) =>
  tabs.filter(({ id }) => id === "settings" || !hiddenTabs.includes(id))
