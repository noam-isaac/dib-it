import type { DibItCourse } from "./models"

export interface RegistrationRow {
  courseId: string
  name: string
  group: string
}
export interface RegistrationDetails {
  studentName: string
  studentId: string
  academicYear: string
  semesterCode: string
  department: string
  registeringDepartment: string
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
      if (!data?.groups?.some((g) => g.group === group) || seen.has(key))
        continue
      seen.add(key)
      rows.push({ courseId: course.id, name: data.name ?? course.id, group })
    }
  }
  return rows
}
