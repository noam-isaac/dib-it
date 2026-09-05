import * as ics from "ics"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"
import timezone from "dayjs/plugin/timezone"
import { DibItCourse } from "./models"
import { parseDateString } from "./utilities"
import { cachedFetch } from "./hooks"
import { isCourseScheduled } from "./exams"

dayjs.extend(utc)
dayjs.extend(timezone)
const DAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"]

const parseTime = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match || +match[1] > 23 || +match[2] > 59) return undefined
  return +match[1] * 60 + +match[2]
}

/** Expand lessons in Jerusalem wall time so imports remain correct across DST
 * and when the browser is in another time zone. Exam dates remain all-day. */
export const createCalendar = (
  semester: string,
  courses: DibItCourse[],
  courseInfo: SemesterCourses,
  info?: GeneralSemesterInfo,
): string => {
  if (!info?.startDate || !info.endDate) {
    throw new Error("תאריכי הסמסטר עדיין אינם זמינים לייצוא.")
  }
  const start = dayjs.utc(dayjs(info.startDate).format("YYYY-MM-DD"))
  const end = dayjs.utc(dayjs(info.endDate).format("YYYY-MM-DD"))
  if (
    !start.isValid() ||
    !end.isValid() ||
    end.isBefore(start) ||
    end.diff(start, "day") > 366
  ) {
    throw new Error("תאריכי הסמסטר אינם תקינים.")
  }
  const events: ics.EventAttributes[] = []
  const seen = new Set<string>()
  const add = (event: ics.EventAttributes & { uid: string }) => {
    if (!seen.has(event.uid)) {
      events.push(event)
      seen.add(event.uid)
    }
  }
  for (const c of courses) {
    const course = courseInfo[c.id]
    if (!course || !isCourseScheduled(c, course)) continue
    for (const exam of course.exams ?? []) {
      const date = parseDateString(exam.date)
      if (!date) continue
      add({
        uid: `${semester}-${c.id}-exam-${exam.date}-${exam.moed ?? ""}@dibit`,
        title: `${course.name ?? c.id} (מועד ${exam.moed ?? ""})`,
        start: [date.getFullYear(), date.getMonth() + 1, date.getDate()],
        duration: { days: 1 },
      })
    }
    for (const group of course.groups ?? []) {
      if (!group.group || !c.groups?.includes(group.group)) continue
      for (const [index, lesson] of (group.lessons ?? []).entries()) {
        const times = lesson.time?.split("-")
        const weekday = DAYS.indexOf(lesson.day ?? "")
        if (times?.length !== 2 || weekday < 0) continue
        const from = parseTime(times[0]),
          to = parseTime(times[1])
        if (from === undefined || to === undefined || to <= from) continue
        const clock = (minutes: number) =>
          `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
        for (
          let date = start.add((weekday - start.day() + 7) % 7, "day");
          !date.isAfter(end);
          date = date.add(7, "day")
        ) {
          const key = date.format("YYYY-MM-DD")
          add({
            uid: `${semester}-${c.id}-${group.group}-${index}-${key}@dibit`,
            title: `${course.name ?? c.id}${lesson.type ? ` (${lesson.type})` : ""}`,
            description: `מרצה: ${group.lecturer ?? ""}\nמספר קורס: ${c.id}\nקבוצה: ${group.group}`,
            location: [lesson.building, lesson.room].filter(Boolean).join(" "),
            start: dayjs
              .tz(`${key} ${clock(from)}`, "Asia/Jerusalem")
              .valueOf(),
            end: dayjs.tz(`${key} ${clock(to)}`, "Asia/Jerusalem").valueOf(),
            startInputType: "utc",
            startOutputType: "utc",
            endInputType: "utc",
            endOutputType: "utc",
          })
        }
      }
    }
  }
  if (!events.length)
    throw new Error("אין שיעורים או מבחנים לייצוא בקבוצות שנבחרו.")
  const { error, value } = ics.createEvents(events, { calName: "Dib It" })
  if (error || !value) throw error ?? new Error("יצירת קובץ היומן נכשלה.")
  return value
}

export const getICS = async (
  semester: string,
  courses: DibItCourse[],
  courseInfo: SemesterCourses,
): Promise<string> => {
  const generalInfo = await cachedFetch<GeneralInfo>(
    "https://arazim-project.com/data/info.json",
  )
  return createCalendar(
    semester,
    courses,
    courseInfo,
    generalInfo.semesters?.[semester],
  )
}
