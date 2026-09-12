import { toHebrewJewishDate } from "jewish-date"
import hash from "./color-hash"
import { DibIt, DibItCourse } from "./models"
import { selectedGroups, type CatalogCourses } from "./catalog"

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
  // Binary search the last x that is smaller than value
  if (value <= sortedList[0]) {
    return sortedList[0]
  }
  if (value >= sortedList[sortedList.length - 1]) {
    return sortedList[sortedList.length - 1]
  }

  let low = 0,
    high = sortedList.length - 1
  while (high > low + 1) {
    const middle = Math.floor((low + high) / 2)
    const middleValue = sortedList[middle]
    if (value >= middleValue) {
      low = middle
    } else {
      high = middle
    }
  }

  if (Math.abs(sortedList[low] - value) < Math.abs(sortedList[high] - value)) {
    return sortedList[low]
  }

  return sortedList[high]
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

export const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  downloadFile(filename, url)
  // Give the browser time to start the download before releasing its bytes.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const createScheduleImage = async () => {
  const element = document.getElementById("schedule-container")
  if (!element) throw new Error("פתחו את לשונית המערכת כדי ליצור תמונה.")
  // Reflow a DOM copy of the existing timetable; never resize the live schedule.
  const wrapper = document.createElement("div")
  wrapper.setAttribute("aria-hidden", "true")
  wrapper.inert = true
  Object.assign(wrapper.style, { position: "fixed", left: "-10000px", top: "0" })
  const copy = element.cloneNode(true) as HTMLElement
  Object.assign(copy.style, { width: "1400px", maxWidth: "none", overflowWrap: "anywhere" })
  copy.style.setProperty("--schedule-hour-height", "100px")
  wrapper.append(copy)
  document.body.append(wrapper)
  try {
    await document.fonts.ready
    // Apple tiles scroll on screen. Let their content determine the image height.
    for (const child of copy.querySelectorAll<HTMLElement>('[style*="overflow: auto"]')) {
      child.style.overflow = "visible"
    }
    const tiles = [...copy.querySelectorAll<HTMLElement>(':scope > div > div[style*="display: grid"] > div')]
    const ratio = Math.max(1, ...tiles.map(tile => tile.scrollHeight / Math.max(1, tile.clientHeight)))
    copy.style.setProperty("--schedule-hour-height", `${Math.ceil(100 * ratio) + 8}px`)
    const { toBlob } = await import("html-to-image")
    const blob = await toBlob(copy, {
      pixelRatio: 2,
      backgroundColor: matchMedia("(prefers-color-scheme: dark)").matches ? "#222" : "#fff",
      skipFonts: true, // The timetable uses system fonts.
    })
    if (!blob) throw new Error("לא ניתן ליצור את התמונה. נסו שוב.")
    return blob
  } finally {
    wrapper.remove()
  }
}

export const uploadJson = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    const element = document.getElementById("upload") as HTMLInputElement
    element.value = ""
    element.onchange = () => {
      if (!element.files?.[0]) return
      const reader = new FileReader()
      reader.addEventListener("load", (e) => {
        try {
          resolve(JSON.parse(e.target!.result as string))
        } catch (error) {
          reject(error)
        }
      })
      reader.onerror = reject
      reader.readAsText(element.files![0])
    }
    element.onerror = reject
    element.click()
  })
}

export { parseDateString } from "./exams"

export const formatSemester = (semester: string) =>
  semester.substring(0, 4) + (semester[4] === "a" ? "א'" : "ב'")

export const formatSemesterInHebrew = (semester: string) => {
  const hebrewSemester = SEMESTERS_TO_HEBREW[semester[4]]
  const year = parseInt(semester.slice(0, 4), 10)
  const jewishYear = toHebrewJewishDate({
    year: year + 3760,
    monthName: "Tishri",
    day: 1,
  })
  return `${jewishYear.year.slice(1)} ${hebrewSemester}`
}

export const FIRST_SEMESTER = "2023a"

export const parseTime = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match || +match[1] > 23 || +match[2] > 59) return undefined
  return +match[1] * 60 + +match[2]
}

export const sumHours = (info: CatalogCourses, view: DibIt) =>
  (view.courses?.[view.semester ?? ""] ?? [])
    .filter(course => info[course.id]?.semester === view.semester)
    .flatMap(course => selectedGroups(course, info[course.id]))
    .flatMap(group => group.status === "ready" ? group.data.lessons ?? [] : [])
    .reduce((minutes, lesson) => {
      if (!/^[א-ו]$/.test(lesson.day ?? "")) return minutes
      const times = lesson.time?.split("-")
      if (times?.length !== 2) return minutes
      const start = parseTime(times[0]), end = parseTime(times[1])
      return minutes + (start !== undefined && end !== undefined && end > start ? end - start : 0)
    }, 0) / 60

/** Scroll to a course and focus its group control after rendering. */
export const revealCourse = (id: string) => {
  requestAnimationFrame(() => {
    const card = document.getElementById(`course-${id}`)
    card?.scrollIntoView({ behavior: "smooth", block: "center" })
    card?.querySelector<HTMLElement>('input[type="checkbox"]')?.focus({ preventScroll: true })
  })
}

export const getPastAndPresentCourses = (dibIt: DibIt, until?: string) => {
  const pastCourses = new Set<string>()
  const pastAndPresentCourses = new Set<string>()
  for (const s of Object.keys(dibIt.courses ?? {}).sort()) {
    if (until && s > until) break
    if (s === until) {
      for (const course of dibIt.courses![s]) {
        pastAndPresentCourses.add(course.id)
      }
      break
    }

    for (const course of dibIt.courses![s]) {
      pastCourses.add(course.id)
      pastAndPresentCourses.add(course.id)
    }
  }
  return [pastCourses, pastAndPresentCourses]
}

export const checkPrerequisites = (
  prerequisites: SemesterCoursesPrerequisiteCourses | undefined,
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
