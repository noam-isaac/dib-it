import type { DibIt, DibItCourse } from "./models"
import { lautmanCourses } from "./lautmanCourses"
import verifiedGroups from "./annualGroups.json"

/** Durable intent while the matching semester catalog is unavailable. null means remove. */
export interface AnnualChange {
  semester: string
  id: string
  groups: string[] | null
}

const otherSemester = (semester: string) => semester.slice(0, 4) + (semester.endsWith("a") ? "b" : "a")

/** Only the official annual-only listing, or an explicit local annual lesson, establishes annual status. */
export const annualGroupIds = (view: DibIt, semester: string, id: string): string[] => {
  const local = Object.assign({}, lautmanCourses, ...Object.values(view.customCourses ?? {})) as SemesterCourses
  if (local[id]) return local[id].groups?.filter(group => group.lessons?.some(lesson => lesson.type === "שנתי"))
    .flatMap(group => group.group ? [group.group] : []) ?? []
  const years = verifiedGroups as Record<string, { groups: Record<string, string[]> }>
  return years[semester.slice(0, 4)]?.groups[id] ?? []
}

const sharedGroups = (view: DibIt, semester: string, id: string, catalogs: Record<string, SemesterCourses>) => {
  const annual = new Set(annualGroupIds(view, semester, id))
  if (!annual.size) return annual
  const local = Object.assign({}, lautmanCourses, ...Object.values(view.customCourses ?? {})) as SemesterCourses
  if (local[id]) return annual
  const source = catalogs[semester]
  const target = catalogs[otherSemester(semester)]
  if (!source || !target) return undefined // Not resolved: retain the user's intent across reloads.
  return new Set([...annual].filter(group =>
    source[id]?.groups?.some(item => item.group === group) && target[id]?.groups?.some(item => item.group === group)))
}

export const annualChanges = (previous: DibIt["courses"], view: DibIt): AnnualChange[] => {
  const semester = view.semester
  if (!semester || !/^\d{4}[ab]$/.test(semester)) return []
  const old = previous?.[semester] ?? []
  const current = view.courses?.[semester] ?? []
  return [...new Set([...old, ...current].map(course => course.id))].flatMap(id => {
    const before = old.find(course => course.id === id)
    const after = current.find(course => course.id === id)
    return !!before !== !!after || JSON.stringify(before?.groups ?? []) !== JSON.stringify(after?.groups ?? [])
      ? [{ semester, id, groups: after ? [...after.groups ?? []] : null }] : []
  })
}

export const applyAnnualChanges = (view: DibIt, changes: AnnualChange[], catalogs: Record<string, SemesterCourses>) => {
  let courses = view.courses ?? {}
  const pending: AnnualChange[] = []
  for (const change of changes) {
    const shared = sharedGroups(view, change.semester, change.id, catalogs)
    if (!shared) { pending.push(change); continue }
    if (!shared.size) continue
    // Replay in order on both sides: the most recent explicit edit wins for shared groups.
    for (const semester of [change.semester, otherSemester(change.semester)]) {
      const list = courses[semester] ?? []
      const existing = list.find(course => course.id === change.id)
      const groups = [...new Set([
        ...(existing?.groups ?? []).filter(group => !shared.has(group)),
        ...(change.groups ?? []).filter(group => shared.has(group)),
      ])]
      const include = change.groups !== null && (!change.groups.length || change.groups.some(group => shared.has(group)))
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
export const reconcileAnnualCourses = (view: DibIt, catalogs: Record<string, SemesterCourses>): DibIt["courses"] => {
  let courses = view.courses
  if (!courses || !view.semester || !/^\d{4}[ab]$/.test(view.semester)) return courses
  for (const semester of [view.semester, otherSemester(view.semester)]) {
    const other = otherSemester(semester)
    const selected: DibItCourse[] = courses[semester] ?? []
    for (const course of selected) {
      const shared = sharedGroups(view, semester, course.id, catalogs)
      if (!shared?.size || courses[other]?.some(existing => existing.id === course.id)) continue
      const groups = course.groups?.filter(group => shared.has(group))
      if (course.groups?.length && !groups?.length) continue
      courses = { ...courses, [other]: [...courses[other] ?? [], { ...course, ...(groups ? { groups } : {}) }] }
    }
  }
  return courses
}

export const syncAnnualCourses = (previous: DibIt["courses"], view: DibIt, catalogs: Record<string, SemesterCourses>): DibIt["courses"] => {
  if (!view.courses) return view.courses
  return applyAnnualChanges(view, annualChanges(previous, view), catalogs).courses
}
