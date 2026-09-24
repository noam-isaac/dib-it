import { selectedGroups, type CatalogCourse, type CatalogCourses, type ExamData } from "./catalog"
import type { DibItCourse } from "./models"

/** Parse the source's calendar dates without retaining the current time of day. */
export const parseDateString = (value?: string): Date | undefined => {
  const match = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3])
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
  info?: CatalogCourse,
) =>
  selectedGroups(course, info).length > 0


export interface CourseExam {
  id: string
  course: DibItCourse
  date: Date
  key: string
  moed: string
  type: string
  hour: string
}

export type ExamScope = "scheduled" | "catalog"
/** Selection filters resolved data; it never changes the catalog or source authority. */
export const courseExamSources = (course: DibItCourse, info: CatalogCourse | undefined, scope: ExamScope = "scheduled"): ExamData[] => {
  if (!info) return []
  const groups = scope === "catalog" ? [...info.groups.keys()] : selectedGroups(course, info).map(group => group.group)
  return [...new Set(groups.length ? groups.map(group => info.groupExamData.get(group) ?? info.examData)
    : scope === "catalog" ? [info.examData] : [])]
}

export const examDataWarnings = (courses: DibItCourse[], info: CatalogCourses, scope: ExamScope = "scheduled") =>
  courses.flatMap(course => {
    const sources = courseExamSources(course, info[course.id], scope)
    const name = info[course.id]?.name ?? course.id
    return sources.some(source => source.status === "unknown") ? [`${name}: נתוני הבחינות חסרים או טרם אומתו.`]
      : sources.some(source => source.status === "stale") ? [`${name}: נתוני הבחינות אינם עדכניים; מוצגים המועדים האחרונים שאומתו.`] : []
  })

export const collectExams = (
  courses: DibItCourse[],
  info: CatalogCourses,
  scope: ExamScope = "scheduled",
): CourseExam[] => {
  const exams: CourseExam[] = []
  const seen = new Set<string>()
  for (const course of courses) {
    for (const exam of courseExamSources(course, info[course.id], scope).flatMap(source => source.exams)) {
      const date = parseDateString(exam.date)
      if (!date) continue
      const key = dateKey(date)
      const identity = JSON.stringify([
        course.id,
        key,
        exam.moed ?? "",
        exam.type ?? "",
        exam.hour ?? "",
      ])
      if (seen.has(identity)) continue
      seen.add(identity)
      exams.push({
        id: identity,
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
  return exams.filter((exam) => exam.key >= from! && exam.key <= to!)
}
