import { Alert } from "@mantine/core"
import { useCourseInfo } from "../CourseInfoContext"
import { examDataWarnings, type ExamScope } from "../exams"
import type { DibItCourse } from "../models"

export default function ExamDataNotice({ courses, scope = "scheduled" }: { courses: DibItCourse[]; scope?: ExamScope }) {
  const warnings = examDataWarnings(courses, useCourseInfo(), scope)
  return warnings.length ? <Alert color="yellow" my="sm">{warnings.slice(0, 3).join(" ")}{warnings.length > 3 && ` ועוד ${warnings.length - 3} קורסים עם מידע חסר או לא עדכני.`}</Alert> : null
}
