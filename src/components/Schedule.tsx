import { selectedGroups, selectedCatalogConflicts } from "../catalog"
import { useColorScheme } from "@mantine/hooks"
import {
  CalendarEvent,
  DaySchedule,
  ScheduleTheme,
  ScheduleView,
  createTheme,
} from "react-schedule-view/src"
import { useCourseInfo } from "../CourseInfoContext"
import { useLocalStorage } from "../hooks"
import { useDibIt } from "../models"
import { getColor, parseTime, revealCourse } from "../utilities"

const googleWideScheduleTheme = createTheme("google", {
  hourHeight: "var(--schedule-hour-height, 85px)",
  minorGridlinesPerHour: 1,
  timeFormatter: (hour: number) => hour.toString() + ":00",
})

const googleCompactScheduleTheme = createTheme("google", {
  hourHeight: "var(--schedule-hour-height, 65px)",
  minorGridlinesPerHour: 1,
  timeFormatter: (hour: number) => hour.toString() + ":00",
})

const wideScheduleTheme = createTheme("apple", {
  hourHeight: "var(--schedule-hour-height, 85px)",
  minorGridlinesPerHour: 1,
  timeFormatter: (hour: number) => hour.toString() + ":00",
})

const compactScheduleTheme = createTheme("apple", {
  hourHeight: "var(--schedule-hour-height, 65px)",
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

const Schedule = () => {
  const courseInfo = useCourseInfo()
  const [compactView] = useLocalStorage<boolean>({
    key: "Compact View",
    defaultValue: false,
  })
  const [dibIt] = useDibIt()
  const colorScheme = useColorScheme()

  const currentCourses = (dibIt.courses ?? {})[dibIt.semester ?? ""] ?? []

  const events = currentCourses.flatMap(course => selectedGroups(course, courseInfo[course.id])
    .flatMap(group => group.status === "ready" ? (group.data.lessons ?? []).flatMap(lesson => {
      const times = lesson.time?.split("-")
      if (times?.length !== 2) return []
      const start = parseTime(times[0]), end = parseTime(times[1])
      if (start === undefined || end === undefined || end <= start) return []
      return [{
        day: lesson.day,
        startTime: start / 60,
        endTime: end / 60,
        title: `${courseInfo[course.id]?.name}${lesson.type ? ` (${lesson.type})` : ""}`,
        description: [lesson.building, lesson.room, group.data.lecturer].filter(Boolean).join(" · "),
        id: course.id,
        color: getColor(course),
      }]
    }) : []))
  const data: DaySchedule[] = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"].map((name, day) => ({
    name, events: events.filter(event => event.day === "אבגדהו"[day]),
  }))
  const conflicts = selectedCatalogConflicts(currentCourses, courseInfo)

  return (
    <div
      className="schedule"
      data-theme={dibIt.theme ?? "apple"}
      style={{
        width: "100%",
        maxWidth: "100%",
        overflowX: "auto",
        overflowY: "clip",
      }}
    >
      <div
        dir="rtl"
        id="schedule-container"
        className={compactView ? "" : "wide"}
        style={{ minWidth: compactView ? undefined : 600, maxWidth: "100%" }}
      >
        {conflicts.length > 0 && <p role="alert" style={{ padding: 8 }}>
          המערכת וסך השעות חלקיים: נתוני קבוצות {conflicts.join(", ")} סותרים במקור.
          הבחירות נשמרו, אך לא ניתן להציג את השיעורים או לייצא עד לתיקון הנתונים או ביטול הבחירה בקבוצות אלה.
        </p>}
        <ScheduleView
          darkMode={colorScheme === "dark"}
          theme={
            compactView
              ? themes[dibIt.theme ?? "apple"][0]
              : themes[dibIt.theme ?? "apple"][1]
          }
          daySchedules={data}
          viewStartTime={8}
          viewEndTime={20}
          handleEventClick={(event) => {
            // @ts-ignore
            const id: string = event.id

            const card = document.getElementById(`course-${id}`)
            if (card) {
              revealCourse(id)
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
