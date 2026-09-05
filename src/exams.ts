import type { DibItCourse } from "./models"

/** Parse the source's calendar dates without retaining the current time of day. */
export const parseDateString = (value?: string): Date | undefined => {
  const match = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return
  const [, day, month, year] = match.map(Number)
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return
  return date
}

export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

export const isCourseScheduled = (
  course: DibItCourse,
  info?: SemesterCourseInfo,
) =>
  info?.groups?.some(
    (group) =>
      group.group !== undefined && course.groups?.includes(group.group),
  ) ?? false

export interface CourseExam {
  course: DibItCourse
  date: Date
  key: string
  moed: string
  type: string
  hour: string
}

export const collectExams = (
  courses: DibItCourse[],
  info: SemesterCourses,
): CourseExam[] => {
  const exams: CourseExam[] = []
  const seen = new Set<string>()
  for (const course of courses) {
    for (const exam of info[course.id]?.exams ?? []) {
      const date = parseDateString(exam.date)
      if (!date) continue
      const key = dateKey(date)
      const identity = JSON.stringify([
        course.id,
        key,
        exam.moed,
        exam.type,
        exam.hour,
      ])
      if (seen.has(identity)) continue
      seen.add(identity)
      exams.push({
        course,
        date,
        key,
        moed: exam.moed ?? "",
        type: exam.type ?? "",
        hour: exam.hour ?? "",
      })
    }
  }
  return exams.sort(
    (a, b) =>
      a.key.localeCompare(b.key) ||
      a.hour.localeCompare(b.hour) ||
      a.course.id.localeCompare(b.course.id),
  )
}

/** Endpoints are inclusive; a single endpoint selects that one day. */
export const filterExamDates = (
  exams: CourseExam[],
  start: string,
  end: string,
) => {
  if (!start && !end) return exams
  const [from, to] = [start || end, end || start].sort()
  return exams.filter((exam) => exam.key >= from && exam.key <= to)
}
