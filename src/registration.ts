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

// Names confirmed by the supplied registration examples. Unknown names are requested.
const departmentNames: Record<string, string> = {
  "0607": "לימודי מגדר",
  "0455": "ביולוגיה",
  "0366": "מתמטיקה",
  "0627": "בלשנות",
  "0618": "פילוסופיה",
  "0368": "מדעי המחשב",
}

export const getRegistrationDepartments = (rows: RegistrationRow[]) =>
  Object.fromEntries([...new Set(rows.map(row => row.courseId.slice(0, 4)))].map(code =>
    [code, { code, name: departmentNames[code] ?? "" }],
  )) as Record<string, RegistrationDepartment>

export const registrationCourseName = (row: RegistrationRow) =>
  `${row.name} - (${row.lessonType})`
