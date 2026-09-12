import { z } from "zod"
import { toHebrewJewishDate } from "jewish-date"
import hash from "./color-hash"
import { DibIt, DibItCourse } from "./models"

export const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24

export const SEMESTERS_TO_NUMBER: Record<string, number> = {
  a: 1,
  b: 2,
}

export const SEMESTERS_TO_HEBREW: Record<string, string> = {
  a: "א'",
  b: "ב'",
}

export const getClosestValue = (value: number, sortedList: number[]) => {
  const first = sortedList[0], last = sortedList[sortedList.length - 1]
  if (first === undefined || last === undefined) return undefined
  // Binary search the last x that is smaller than value
  if (value <= first) {
    return first
  }
  if (value >= last) {
    return last
  }

  let low = 0,
    high = sortedList.length - 1
  while (high > low + 1) {
    const middle = Math.floor((low + high) / 2)
    const middleValue = sortedList[middle]
    if (middleValue === undefined) return undefined
    if (value >= middleValue) {
      low = middle
    } else {
      high = middle
    }
  }

  const lower = sortedList[low], upper = sortedList[high]
  if (lower === undefined || upper === undefined) return undefined
  if (Math.abs(lower - value) < Math.abs(upper - value)) {
    return lower
  }

  return upper
}

export const getColor = (course: DibItCourse): string => {
  return course.color ?? getDefaultColor(course)
}

export const getDefaultColor = (course: DibItCourse): string => {
  return hash.hex(course.id)
}

export const downloadFile = (filename: string, contents: string) => {
  const element = document.getElementById("download") as HTMLAnchorElement
  element.href = contents
  element.download = filename
  element.click()
}

export const uploadJson = <T>(schema: z.ZodType<T>): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    const element = document.getElementById("upload") as HTMLInputElement
    element.value = ""
    element.oncancel = () => resolve(undefined)
    element.onchange = () => {
      const file = element.files?.[0]
      if (!file) { resolve(undefined); return }
      const reader = new FileReader()
      reader.addEventListener("load", () => {
        try {
          if (typeof reader.result !== "string") throw new Error("לא ניתן לקרוא את הקובץ.")
          const input: unknown = JSON.parse(reader.result)
          resolve(schema.parse(input))
        } catch (error: unknown) { reject(error) }
      })
      reader.onerror = reject
      reader.onabort = () => resolve(undefined)
      reader.readAsText(file)
    }
    element.onerror = reject
    element.click()
  })
}

export const parseDateString = (date: string | undefined) => {
  if (!date || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
    return
  }
  const [day, month, year] = date.split("/")
  if (!day || !month || !year) return
  const d = new Date()
  d.setFullYear(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10))
  if (d.getFullYear() !== Number(year) || d.getMonth() !== Number(month) - 1 || d.getDate() !== Number(day)) return

  return d
}

export const formatSemester = (semester: string) =>
  semester.substring(0, 4) + (semester[4] === "a" ? "א'" : "ב'")

export const formatSemesterInHebrew = (semester: string) => {
  const hebrewSemester = SEMESTERS_TO_HEBREW[semester.charAt(4)]
  const year = parseInt(semester.slice(0, 4), 10)
  const jewishYear = toHebrewJewishDate({
    year: year + 3760,
    monthName: "Tishri",
    day: 1,
  })
  return `${jewishYear.year.slice(1)} ${hebrewSemester}`
}

export const FIRST_SEMESTER = "2023a"

export const getPastAndPresentCourses = (dibIt: DibIt, until?: string) => {
  const pastCourses = new Set<string>()
  const pastAndPresentCourses = new Set<string>()
  for (const s of Object.keys(dibIt.courses ?? {}).sort()) {
    if (s === until) {
      for (const course of dibIt.courses?.[s] ?? []) {
        pastAndPresentCourses.add(course.id)
      }
      break
    }

    for (const course of dibIt.courses?.[s] ?? []) {
      pastCourses.add(course.id)
      pastAndPresentCourses.add(course.id)
    }
  }
  return [pastCourses, pastAndPresentCourses] as const
}

export const checkPrerequisites = (
  prerequisites: SemesterCoursesPrerequisiteCourses | null | undefined,
  pastCourses: Set<string>,
  pastAndPresentCourses: Set<string>,
  format?: (courseId: string) => string,
  root = true
): string | undefined => {
  if (!prerequisites) {
    return
  }

  const doesntHaveCourse = (
    course: string | SemesterCoursesPrerequisiteCourses
  ) => {
    if (typeof course === "string") {
      if (!pastCourses.has(course)) {
        return format?.(course) ?? course
      }
    } else {
      return checkPrerequisites(
        course,
        pastCourses,
        pastAndPresentCourses,
        format,
        false
      )
    }
    return undefined
  }

  if (prerequisites.parallel) {
    const parallelResults = checkPrerequisites(
      prerequisites.parallel,
      pastAndPresentCourses,
      pastAndPresentCourses,
      format,
      root
    )
    if (parallelResults) {
      return "במקביל " + parallelResults
    }
  }

  if (!prerequisites.kind || !prerequisites.courses) {
    return
  }

  let results = prerequisites?.courses
    .map(doesntHaveCourse)
    .filter((r) => r !== undefined)
  const ok =
    prerequisites.kind === "all"
      ? results.length === 0
      : results.length < prerequisites.courses.length
  if (ok) {
    return
  }
  const r =
    prerequisites.kind === "all" ? results.join(" וגם ") : results.join(" או ")
  return root ? r : `(${r})`
}
