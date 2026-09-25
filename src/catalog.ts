import "core-js/es/map/group-by"
import type { DibItCourse } from "./models"
import { isCourseCatalog } from "./scheduleBackup"
import type { AnnualYear } from "./annualRegistry"
import { lautmanCourses } from "./lautmanCourses"

export type CourseDetails = Omit<SemesterCourseInfo, "groups">
type GroupRecord = Readonly<Omit<SemesterCourseGroupInfo, "lessons">> & {
  readonly lessons?: readonly Readonly<SemesterCourseGroupLessonInfo>[] | undefined
}
export type CatalogGroup = { readonly group: string } & (
  | { readonly status: "ready"; readonly data: GroupRecord }
  | { readonly status: "conflict"; readonly records: readonly GroupRecord[] }
)
export type ExamData = {
  readonly status: "ready" | "unknown" | "stale"
  readonly source: "catalog" | "tau" | "custom"
  readonly verifiedAt?: string | undefined
  readonly exams: readonly SemesterCourseExamInfo[]
}
export type CatalogCourse = Readonly<Omit<CourseDetails, "exams">> & {
  readonly semester: string
  readonly groups: ReadonlyMap<string, CatalogGroup>
  readonly unidentifiedGroups: readonly GroupRecord[]
  readonly examData: ExamData
  readonly groupExamData: ReadonlyMap<string, ExamData>
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
  return Object.fromEntries(Object.entries(source).map(([id, { exams, ...course }]) => [id, {
    ...course,
    examData: { source: "catalog", status: exams === undefined ? "unknown" : "ready", exams: exams ?? [] },
    groupExamData: new Map(),
    semester,
    groups: new Map([...Map.groupBy((course.groups ?? []).filter(row => !!row.group), row => row.group!).entries()]
      .map(([group, records]): [string, CatalogGroup] => [group, records.every(row => sameGroup(records[0]!, row))
        ? { group, status: "ready", data: records[0]! }
        : { group, status: "conflict", records }])),
    unidentifiedGroups: (course.groups ?? []).filter(row => !row.group),
  }]))
}

/** One resolved catalog, independent of plans or selected groups. Local catalogs own their courses. */
export const resolveCatalog = (
  semester: string,
  catalog: CatalogCourses,
  annual?: AnnualYear,
  custom: Record<string, SemesterCourses> = {},
  feedFailed = false,
): CatalogCourses => {
  const official = Object.fromEntries(Object.entries(catalog).map(([id, course]) => {
    if (!course) return [id, course]
    const snapshot = annual?.exams?.[id]
    const stale = feedFailed || !!annual?.examFailures?.[id]
    return [id, { ...course, groupExamData: new Map((annual?.groups[id] ?? [])
      .filter(group => course.groups.has(group)).map(group => [group, {
        source: "tau" as const,
        status: snapshot?.groups[group] === undefined ? "unknown" as const : stale ? "stale" as const : "ready" as const,
        verifiedAt: snapshot?.verifiedAt,
        exams: (snapshot?.groups[group] ?? []).filter(exam => (exam.type?.includes("ביניים") ?? false) === semester.endsWith("a")),
      }])) }]
  }))
  const local = importSemesterCourses(semester, { ...lautmanCourses,
    ...Object.fromEntries(Object.values(custom).flatMap(Object.entries)),
  })
  return { ...official, ...Object.fromEntries(Object.entries(local).map(([id, course]) => [id,
    course && { ...course, examData: { ...course.examData, source: "custom" as const } },
  ])) }
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
