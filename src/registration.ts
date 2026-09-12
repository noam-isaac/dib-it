import { assertCatalogSelection, selectedGroups, type CatalogCourses, type CourseDetails } from "./catalog"
import type { DibItCourse } from "./models"
import { lautmanCourses } from "./lautmanCourses"

export interface RegistrationRow {
  courseId: string
  name: string
  group: string
  lessonType: string
}
export interface RegistrationDetails {
  studentName: string
  studentId: string
  academicYear: string
  semesterCode: string
  department: string
  registeringDepartment: string
  registeringDepartmentName: string
  degree: string
  framework: string
}

export const registrationDefaults = (
  semester: string,
): RegistrationDetails => ({
  studentName: "",
  studentId: "",
  academicYear: String(Number(semester.slice(0, 4)) - 1),
  semesterCode: semester.endsWith("b") ? "2" : "1",
  department: "1821",
  registeringDepartment: "",
  registeringDepartmentName: "",
  degree: "ראשון",
  framework: "999",
})

/** Preserve leading zeroes and include each selected, currently valid group once. */
export const getRegistrationRows = (
  courses: DibItCourse[],
  info: CatalogCourses,
): RegistrationRow[] => {
  assertCatalogSelection(courses, info)
  return [...new Map(courses.flatMap(course => {
    // Local scheduling entries have no official registration course number.
    if (Object.prototype.hasOwnProperty.call(lautmanCourses, course.id)) return []
    return selectedGroups(course, info[course.id]).flatMap(group => group.status === "ready" ? [{
      courseId: course.id, name: info[course.id]?.name?.trim() ?? "", group: group.group,
      lessonType: [...new Set(group.data.lessons?.map(lesson => lesson.type?.trim()).filter(Boolean))].join(" ו"),
    }] : [])
  }).map(row => [`${row.courseId}/${row.group}`, row])).values()]
}

export interface RegistrationDepartment {
  code: string
  name: string
}

export const getRegistrationDepartments = (rows: RegistrationRow[], info: Readonly<Record<string, CourseDetails | undefined>>): Record<string, RegistrationDepartment> => {
  const names = new Map<string, Set<string>>()
  for (const row of rows) {
    const code = row.courseId.slice(0, 4)
    if (!names.has(code)) names.set(code, new Set())
    // The catalog stores "faculty/department". Missing or conflicting names stay blank.
    const name = info[row.courseId]?.faculty?.split("/").slice(1).join("/").trim()
    if (name) names.get(code)!.add(name)
  }
  return Object.fromEntries([...names].map(([code, values]) =>
    [code, { code, name: values.size === 1 ? [...values][0] : "" }],
  ))
}

/** The original form prints these fields into a fixed number of single-digit boxes. */
const boxedFields: Record<string, number> = {
  studentId: 9, department: 4, registeringDepartment: 4,
  framework: 3, courseId: 8, group: 2, year: 2, semesterCode: 1,
}
export const fitsRegistrationBoxes = (field: string, value: string) =>
  !(field in boxedFields) || new RegExp(`^[0-9]{${boxedFields[field]}}$`).test(value)
export const isRegistrationBoxField = (field: string) => field in boxedFields

/** A course number or group the boxes cannot hold has no place on the printed form. */
export const registrationRowFitsForm = (row: RegistrationRow) =>
  fitsRegistrationBoxes("courseId", row.courseId) && fitsRegistrationBoxes("group", row.group)

export const registrationCourseName = (row: RegistrationRow) =>
  row.name.trim() ? [row.name, row.lessonType && `(${row.lessonType})`].filter(Boolean).join(" - ") : ""
