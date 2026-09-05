import type { DibIt } from "./models"
import type { PlanWorkspace } from "./plans"

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

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
  if (!("plans" in value)) return true
  if (!Array.isArray(value.plans) || !value.plans.length) return false
  const ids = new Set<string>()
  for (const plan of value.plans) {
    if (!object(plan) || typeof plan.id !== "string" || !plan.id.trim() ||
      typeof plan.name !== "string" || !plan.name.trim() ||
      ids.has(plan.id) || !isLegacySchedule(plan) || "plans" in plan) return false
    ids.add(plan.id)
  }
  return typeof value.activePlanId === "string" && ids.has(value.activePlanId)
}
