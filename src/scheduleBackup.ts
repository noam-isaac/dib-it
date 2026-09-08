import type { DibIt } from "./models"
import type { PlanWorkspace } from "./plans"

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string")

const textFields = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  object(value) && keys.every(key => value[key] === undefined || typeof value[key] === "string")

const prerequisites = (value: unknown): boolean => {
  const pending = [value]
  while (pending.length) {
    const item = pending.pop()
    if (item == null) continue
    if (!object(item) || (item.kind !== undefined && item.kind !== "all" && item.kind !== "any")) return false
    if (item.courses !== undefined) {
      if (!Array.isArray(item.courses)) return false
      for (const course of item.courses) {
        if (typeof course === "string") continue
        if (!object(course)) return false
        pending.push(course)
      }
    }
    if (item.parallel !== undefined) pending.push(item.parallel)
  }
  return true
}

/** Validate the nested catalog too: it is consumed directly by course and exam views. */
const courseCatalog = (value: unknown): boolean =>
  object(value) && Object.values(value).every(course =>
    textFields(course, ["name", "faculty"]) &&
    (course.exams === undefined || (Array.isArray(course.exams) && course.exams.every(exam =>
      textFields(exam, ["date", "moed", "hour", "type"])))) &&
    (course.groups === undefined || (Array.isArray(course.groups) && course.groups.every(group =>
      textFields(group, ["group", "lecturer"]) &&
      (group.lessons === undefined || (Array.isArray(group.lessons) && group.lessons.every(lesson =>
        textFields(lesson, ["day", "time", "type", "building", "room"]))))))) &&
    (course.exam_links === undefined || strings(course.exam_links)) &&
    prerequisites(course.prerequisites),
  )

const isLegacySchedule = (value: unknown): value is DibIt => {
  if (!object(value)) return false
  for (const key of [
    "semester",
    "tab",
    "school",
    "studyPlan",
    "degreeStartYear",
    "theme",
  ]) {
    if (value[key] !== undefined && typeof value[key] !== "string") return false
  }
  if (value.semester && !/^\d{4}[ab]$/.test(value.semester as string)) return false
  if (value.theme !== undefined && value.theme !== "apple" && value.theme !== "google") return false
  if (value.openedPracticeCourses !== undefined && !strings(value.openedPracticeCourses)) return false
  if (value.practicedExams !== undefined &&
    (!object(value.practicedExams) || !Object.values(value.practicedExams).every(strings))) return false
  if (value.customCourses !== undefined &&
    (!object(value.customCourses) || !Object.values(value.customCourses).every(courseCatalog))) return false
  if (value.savedStudyPlans !== undefined &&
    (!Array.isArray(value.savedStudyPlans) || !value.savedStudyPlans.every(plan =>
      object(plan) && typeof plan.school === "string" && !!plan.school.trim() &&
      typeof plan.studyPlan === "string" && !!plan.studyPlan.trim()))) return false
  if (
    value.courses !== undefined &&
    (!object(value.courses) ||
      !Object.values(value.courses).every(
        (courses) =>
          Array.isArray(courses) &&
          courses.every(
            (course) =>
              object(course) &&
              typeof course.id === "string" &&
              (course.color === undefined || typeof course.color === "string") &&
              (course.studyPlanCategory === undefined || typeof course.studyPlanCategory === "string") &&
              (course.groups === undefined ||
                (Array.isArray(course.groups) &&
                  course.groups.every((group) => typeof group === "string"))),
          ),
      ))
  )
    return false
  return true
}

export const isScheduleBackup = (value: unknown): value is DibIt | PlanWorkspace => {
  if (!isLegacySchedule(value)) return false
  if (!("plans" in value)) return [
    "courses", "semester", "tab", "school", "studyPlan", "degreeStartYear", "theme",
    "savedStudyPlans", "openedPracticeCourses", "practicedExams", "customCourses",
  ].some(key => value[key as keyof DibIt] !== undefined)
  if (!Array.isArray(value.plans) || !value.plans.length) return false
  const ids = new Set<string>()
  for (const plan of value.plans) {
    if (!object(plan) || typeof plan.id !== "string" || !plan.id.trim() ||
      typeof plan.name !== "string" || !plan.name.trim() ||
      ids.has(plan.id) || !isLegacySchedule(plan) || "plans" in plan) return false
    if (plan.pendingAnnualChanges !== undefined &&
      (!Array.isArray(plan.pendingAnnualChanges) || !plan.pendingAnnualChanges.every(change =>
        object(change) && typeof change.semester === "string" && /^\d{4}[ab]$/.test(change.semester) &&
        typeof change.id === "string" && !!change.id && (change.groups === null || strings(change.groups))))) return false
    ids.add(plan.id)
  }
  return typeof value.activePlanId === "string" && ids.has(value.activePlanId)
}
