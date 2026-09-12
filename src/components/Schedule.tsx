import { booleanSchema } from "../schemas"
import { useColorScheme } from "@mantine/hooks"
import {
  CalendarEvent,
  DaySchedule,
  ScheduleTheme,
  ScheduleView,
  createTheme,
} from "react-schedule-view/dist/index"
import { useCourseInfo } from "../CourseInfoContext"
import { useLocalStorage } from "../hooks"
import { useDibIt } from "../models"
import { getColor } from "../utilities"

const googleWideScheduleTheme = createTheme("google", {
  hourHeight: "85px",
  minorGridlinesPerHour: 1,
  timeFormatter: (hour: number) => hour.toString() + ":00",
})

const googleCompactScheduleTheme = createTheme("google", {
  hourHeight: "65px",
  minorGridlinesPerHour: 1,
  timeFormatter: (hour: number) => hour.toString() + ":00",
})

const wideScheduleTheme = createTheme("apple", {
  hourHeight: "85px",
  minorGridlinesPerHour: 1,
  timeFormatter: (hour: number) => hour.toString() + ":00",
})

const compactScheduleTheme = createTheme("apple", {
  hourHeight: "65px",
  minorGridlinesPerHour: 1,
  timeFormatter: (hour: number) => hour.toString() + ":00",
})

const themes: Record<
  string,
  [ScheduleTheme<CalendarEvent>, ScheduleTheme<CalendarEvent>]
> = {
  google: [googleCompactScheduleTheme, googleWideScheduleTheme],
  apple: [compactScheduleTheme, wideScheduleTheme],
}

const DAY_INDEX: Record<string, number> = {
  א: 5,
  ב: 4,
  ג: 3,
  ד: 2,
  ה: 1,
  ו: 0,
}

const Schedule = () => {
  const courseInfo = useCourseInfo()
  const [compactView] = useLocalStorage({
    schema: booleanSchema,
    key: "Compact View",
    defaultValue: false,
  })
  const [dibIt] = useDibIt()
  const colorScheme = useColorScheme()

  const currentCourses = (dibIt.courses ?? {})[dibIt.semester ?? ""] ?? []

  const data: DaySchedule<CalendarEvent & { id: string }>[] = [
    { name: "שישי", events: [] },
    { name: "חמישי", events: [] },
    { name: "רביעי", events: [] },
    { name: "שלישי", events: [] },
    { name: "שני", events: [] },
    { name: "ראשון", events: [] },
  ]

  for (const course of currentCourses) {
    for (const group of course.groups ?? []) {
      const info = courseInfo[course.id]?.groups?.find((g) => g.group === group)

      if (info === undefined) {
        continue
      }

      for (const lesson of info.lessons ?? []) {
        try {
          const [startHourStr, endHourStr] = lesson.time!.split("-")
          if (!startHourStr || !endHourStr) continue
          const startHour =
            parseInt(startHourStr.split(":")[0] ?? "", 10) +
            parseInt(startHourStr.split(":")[1] ?? "0", 10) / 60
          const endHour =
            parseInt(endHourStr.split(":")[0] ?? "", 10) +
            parseInt(endHourStr.split(":")[1] ?? "0", 10) / 60
          const dayIndex = DAY_INDEX[lesson.day ?? ""]
          const day = dayIndex === undefined ? undefined : data[dayIndex]
          if (!day) continue
          day.events.push({
            startTime: startHour,
            endTime: endHour,
            title: `${courseInfo[course.id]?.name} (${lesson.type})`,
            description: `${lesson.building}  ${lesson.room} ${
              info.lecturer !== null ? " (" + info.lecturer + ")" : ""
            }`,
            id: course.id,
            color: getColor(course),
          })
        } catch (ignored) {}
      }
    }
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        overflowX: "auto",
        overflowY: "clip",
      }}
    >
      <div
        dir="ltr"
        id="schedule-container"
        className={compactView ? "" : "wide"}
        style={{ minWidth: compactView ? undefined : 600, maxWidth: "100%" }}
      >
        <ScheduleView
          darkMode={colorScheme === "dark"}
          theme={
            compactView
              ? (themes[dibIt.theme ?? "apple"] ?? [compactScheduleTheme, wideScheduleTheme])[0]
              : (themes[dibIt.theme ?? "apple"] ?? [compactScheduleTheme, wideScheduleTheme])[1]
          }
          daySchedules={data}
          viewStartTime={8}
          viewEndTime={20}
          handleEventClick={(event) => {
            const id: string = event.id

            const card = document.getElementById(`course-${id}`)
            if (card) {
              card.scrollIntoView({ behavior: "instant" })
              card.style.scale = "1.03"
              setTimeout(() => (card.style.scale = "1"), 500)
            }
          }}
        />
      </div>
    </div>
  )
}

export default Schedule
