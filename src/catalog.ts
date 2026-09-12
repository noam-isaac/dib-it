import "core-js/es/map/group-by"
import type { DibItCourse } from "./models"
import { isCourseCatalog } from "./scheduleBackup"

export type CourseDetails = Omit<SemesterCourseInfo, "groups">
type GroupRecord = Readonly<Omit<SemesterCourseGroupInfo, "lessons">> & {
  readonly lessons?: readonly Readonly<SemesterCourseGroupLessonInfo>[]
}
export type CatalogGroup = { readonly group: string } & (
  | { readonly status: "ready"; readonly data: GroupRecord }
  | { readonly status: "conflict"; readonly records: readonly GroupRecord[] }
)
export type CatalogCourse = Readonly<CourseDetails> & {
  readonly semester: string
  readonly groups: ReadonlyMap<string, CatalogGroup>
  readonly unidentifiedGroups: readonly GroupRecord[]
}
export type CatalogCourses = Readonly<Record<string, CatalogCourse | undefined>>

export function assertCourseCatalog(source: unknown): asserts source is Record<string, SemesterCourseInfo> {
  if (!isCourseCatalog(source)) throw new Error("נתוני הקורסים אינם תקינים.")
}

const sameLesson = (a: SemesterCourseGroupLessonInfo, b: SemesterCourseGroupLessonInfo) =>
  a.day === b.day && a.time === b.time && a.building === b.building &&
  a.room === b.room && a.type === b.type

// Lesson order is not part of group identity, but multiplicity and every field are.
// ponytail: quadratic in lessons per group; index by fields if lesson lists become large.
const sameGroup = (a: GroupRecord, b: GroupRecord) =>
  a === b || (a.lecturer === b.lecturer && (a.lessons?.length ?? 0) === (b.lessons?.length ?? 0) &&
  (a.lessons ?? []).every(lesson =>
    a.lessons!.filter(other => sameLesson(lesson, other)).length ===
    (b.lessons ?? []).filter(other => sameLesson(lesson, other)).length))

/** Import source rows once into identities scoped to this semester (including year).
 * Repeated equivalent records resolve to one original record. Conflicting records
 * remain unresolved; never union lessons, concatenate lecturers, or pick a winner.
 */
export const importSemesterCourses = (semester: string, source: unknown): CatalogCourses => {
  assertCourseCatalog(source)
  if (!/^\d{4}[ab]$/.test(semester)) throw new Error("נתוני הקורסים אינם תקינים.")
  return Object.fromEntries(Object.entries(source).map(([id, course]) => [id, {
    ...course,
    semester,
    groups: new Map([...Map.groupBy((course.groups ?? []).filter(row => !!row.group), row => row.group!).entries()]
      .map(([group, records]): [string, CatalogGroup] => [group, records.every(row => sameGroup(records[0], row))
        ? { group, status: "ready", data: records[0] }
        : { group, status: "conflict", records }])),
    unidentifiedGroups: (course.groups ?? []).filter(row => !row.group),
  }]))
}

/** A selected identity is visited once, irrespective of source-row repetition. */
export const selectedGroups = (course: DibItCourse, info?: CatalogCourse): CatalogGroup[] =>
  [...new Set(course.groups ?? [])].flatMap(id => info?.groups.get(id) ?? [])

export const selectedCatalogConflicts = (courses: DibItCourse[], info: CatalogCourses) =>
  courses.flatMap(course => selectedGroups(course, info[course.id])
    .filter(group => group.status === "conflict").map(group => `${course.id}/${group.group}`))

export const assertCatalogSelection = (courses: DibItCourse[], info: CatalogCourses, semester?: string) => {
  const conflicts = selectedCatalogConflicts(courses, info)
  if (conflicts.length) throw new Error(`לא ניתן לייצא: נתוני הקבוצות סותרים במקור (${conflicts.join(", ")}).`)
  if (semester && courses.some(course => info[course.id] && info[course.id]!.semester !== semester)) {
    throw new Error("נתוני הקורסים אינם שייכים לסמסטר הנבחר.")
  }
}
