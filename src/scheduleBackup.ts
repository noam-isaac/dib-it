import type { DibIt } from "./models"

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export const isScheduleBackup = (value: unknown): value is DibIt => {
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
              (course.groups === undefined ||
                (Array.isArray(course.groups) &&
                  course.groups.every((group) => typeof group === "string"))),
          ),
      ))
  )
    return false
  return true
}
