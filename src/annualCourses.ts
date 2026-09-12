import type { CatalogCourses } from "./catalog"
import type { DibIt, DibItCourse } from "./models"
import { lautmanCourses } from "./lautmanCourses"
import { annualYear } from "./annualRegistry"

/** Durable intent while the matching semester catalog is unavailable. null means remove. */
export interface AnnualChange {
  semester: string
  id: string
  groups: string[] | null
  /** Only these annual groups were edited. Absent in older backups that stored whole selections. */
  changedGroups?: string[]
  /** The edit predates this year's classification; filter its delta once data arrives. */
  awaitingClassification?: true
}

const otherSemester = (semester: string) => semester.slice(0, 4) + (semester.endsWith("a") ? "b" : "a")
// Course IDs already index each source; checking one course must not import every course.
const localCourse = (view: DibIt, id: string): SemesterCourseInfo | undefined =>
  Object.values(view.customCourses ?? {}).reduce((course, source) => source[id] ?? course, lautmanCourses[id])

/** Only the official annual-only listing, or an explicit local annual lesson, establishes annual status. */
export const annualGroupIds = (view: DibIt, semester: string, id: string): string[] => {
  const local = localCourse(view, id)
  // A timing/lecturer conflict cannot revoke an explicitly annual local selection.
  if (local) return [...new Set((local.groups ?? []).filter(group =>
    group.group && group.lessons?.some(lesson => lesson.type === "שנתי")).map(group => group.group!))]
  return annualYear(semester.slice(0, 4))?.groups[id] ?? []
}

/** Availability is separate from annual status: incomplete lesson data cannot revoke an edit. */
const availableAnnualGroups = (view: DibIt, semester: string, id: string, catalogs: Record<string, CatalogCourses>) => {
  const local = localCourse(view, id)
  const source = catalogs[semester]?.[id]
  const target = catalogs[otherSemester(semester)]?.[id]
  return new Set(annualGroupIds(view, semester, id).filter(group =>
    local || (source?.groups.has(group) && target?.groups.has(group))))
}

export const annualChanges = (previous: DibIt["courses"], view: DibIt): AnnualChange[] => {
  const semester = view.semester
  if (!semester || !/^\d{4}[ab]$/.test(semester)) return []
  const old = previous?.[semester] ?? []
  const current = view.courses?.[semester] ?? []
  return [...new Set([...old, ...current].map(course => course.id))].flatMap(id => {
    const before = old.find(course => course.id === id)
    const after = current.find(course => course.id === id)
    const annual = annualGroupIds(view, semester, id)
    const awaitingClassification = !localCourse(view, id) && !annualYear(semester.slice(0, 4))
    if (!annual.length && !awaitingClassification) return []
    const other = view.courses?.[otherSemester(semester)]?.find(course => course.id === id)
    const candidates = awaitingClassification ? [...new Set([...(before?.groups ?? []), ...(after?.groups ?? []), ...(other?.groups ?? [])])] : annual
    const changedGroups = candidates.filter(group => after
      ? !!before?.groups?.includes(group) !== !!after.groups?.includes(group)
      : before?.groups?.includes(group) || other?.groups?.includes(group))
    return !!before !== !!after || changedGroups.length
      ? [{ semester, id, groups: after ? [...after.groups ?? []] : null, changedGroups, ...(awaitingClassification ? { awaitingClassification: true as const } : {}) }] : []
  })
}

export const applyAnnualChanges = (view: DibIt, changes: AnnualChange[], catalogs: Record<string, CatalogCourses>) => {
  let courses = view.courses ?? {}
  const pending: AnnualChange[] = []
  const blocked = new Set<string>()
  for (const change of changes) {
    const annual = new Set(annualGroupIds(view, change.semester, change.id))
    const classified = !!localCourse(view, change.id) || !!annualYear(change.semester.slice(0, 4))
    if (classified && !annual.size) continue
    const changed = new Set((change.changedGroups ?? [...annual]).filter(group => !classified || annual.has(group)))
    // A corrected classification can retire every group in an older edit.
    if (classified && change.changedGroups?.length && !changed.size) continue
    const available = availableAnnualGroups(view, change.semester, change.id, catalogs)
    const key = `${change.semester.slice(0, 4)}:${change.id}`
    // A successful HTTP response may still be incomplete. Never acknowledge an unapplied edit.
    if (blocked.has(key) || !available.size || [...changed].some(group => !available.has(group))) {
      blocked.add(key)
      pending.push(change)
      continue
    }
    // Apply only the user's delta; selections they did not edit remain owned by their semester.
    for (const semester of [change.semester, otherSemester(change.semester)]) {
      const list = courses[semester] ?? []
      const existing = list.find(course => course.id === change.id)
      const groups = [...new Set([
        ...(existing?.groups ?? []).filter(group => !available.has(group) || !changed.has(group)),
        ...(change.groups ?? []).filter(group => available.has(group) && changed.has(group)),
      ])]
      const include = change.groups !== null && (!change.groups.length || change.groups.some(group => available.has(group)))
      const replacement: DibItCourse | undefined = include || groups.length ? {
        ...existing, id: change.id, groups,
      } : undefined
      if (!existing && !replacement) continue
      courses = { ...courses, [semester]: existing
        ? list.flatMap(course => course.id === change.id ? replacement ? [replacement] : [] : [course])
        : replacement ? [...list, replacement] : list }
    }
  }
  return { courses, pending }
}

/** Fill missing courses only. Existing differing selections are never unioned on load. */
export const reconcileAnnualCourses = (view: DibIt, catalogs: Record<string, CatalogCourses>, pending: AnnualChange[] = []): DibIt["courses"] => {
  let courses = view.courses
  if (!courses || !view.semester || !/^\d{4}[ab]$/.test(view.semester)) return courses
  for (const semester of [view.semester, otherSemester(view.semester)]) {
    const other = otherSemester(semester)
    const selected: DibItCourse[] = courses[semester] ?? []
    for (const course of selected) {
      // Suppress resurrection only for the course/year whose edit is still pending.
      if (pending.some(change => change.id === course.id && change.semester.slice(0, 4) === semester.slice(0, 4))) continue
      const available = availableAnnualGroups(view, semester, course.id, catalogs)
      if (!available.size || courses[other]?.some(existing => existing.id === course.id)) continue
      const groups = course.groups?.filter(group => available.has(group))
      if (course.groups?.length && !groups?.length) continue
      courses = { ...courses, [other]: [...courses[other] ?? [], { ...course, ...(groups ? { groups } : {}) }] }
    }
  }
  return courses
}
