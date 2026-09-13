import { semesterCoursesSchema, scheduleBackupSchema } from "./schemas"
import type { DibIt } from "./models"
import type { PlanWorkspace } from "./plans"

export const isCourseCatalog = (value: unknown): value is SemesterCourses =>
  semesterCoursesSchema.safeParse(value).success

export const isScheduleBackup = (value: unknown): value is DibIt | PlanWorkspace =>
  scheduleBackupSchema.safeParse(value).success
