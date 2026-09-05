import type { DibItCourse } from "./models"

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
  academicYear: semester.slice(0, 4),
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
  info: SemesterCourses,
): RegistrationRow[] => {
  const rows: RegistrationRow[] = [],
    seen = new Set<string>()
  for (const course of courses) {
    const data = info[course.id]
    for (const group of course.groups ?? []) {
      const key = `${course.id}/${group}`
      const selected = data?.groups?.find((g) => g.group === group)
      if (!selected || seen.has(key))
        continue
      seen.add(key)
      const lessonType = [...new Set(selected.lessons?.map((lesson) => lesson.type?.trim()).filter(Boolean))].join(" ו")
      rows.push({ courseId: course.id, name: data?.name?.trim() ?? "", group, lessonType })
    }
  }
  return rows
}

export interface RegistrationDepartment {
  code: string
  name: string
}

export const getRegistrationDepartments = (rows: RegistrationRow[], info: SemesterCourses): Record<string, RegistrationDepartment> => {
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

export const registrationCourseName = (row: RegistrationRow) =>
  [row.name, row.lessonType && `(${row.lessonType})`].filter(Boolean).join(" - ")
