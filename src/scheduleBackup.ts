import { semesterCoursesSchema } from "./schemas"
import type { DibIt } from "./models"
import type { PlanWorkspace } from "./plans"
import { decodeWorkspace, workspaceVersion } from "./workspaceFormat"
import { z } from "zod"

export const isCourseCatalog = (value: unknown): value is SemesterCourses =>
  semesterCoursesSchema.safeParse(value).success

/** A backup must contain schedule fields, then use the same decoder as local storage. */
export const readScheduleBackup = (value: unknown): PlanWorkspace => {
  try {
    workspaceVersion(value)
    if (!value || typeof value !== "object" || Array.isArray(value) || ![
      "plans", "courses", "semester", "tab", "school", "studyPlan", "degreeStartYear", "theme",
      "savedStudyPlans", "openedPracticeCourses", "practicedExams", "customCourses",
    ].some(key => (value as Record<string, unknown>)[key] !== undefined))
      throw new Error("הקובץ אינו גיבוי תקין של Dib It.")
    return decodeWorkspace(value)
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error("הקובץ אינו גיבוי תקין של Dib It.")
    throw error
  }
}

export const isScheduleBackup = (value: unknown): value is DibIt | PlanWorkspace => {
  try { readScheduleBackup(value); return true } catch { return false }
}
