import { Button, Group, Text, Tooltip } from "@mantine/core"
import { Calendar } from "@mantine/dates"
import React, { useState } from "react"
import dayjs from "dayjs"
import ExamSearch from "./ExamSearch"
import { collectExams, isCourseScheduled, type CourseExam } from "../exams"
import { useCourseInfo } from "../CourseInfoContext"
import { useDibIt } from "../models"
import { MILLISECONDS_IN_DAY, getColor } from "../utilities"

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
const DAY_LETTERS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"]
const MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
]

const stringifyDate = (d: Date) => {
  return d.getDate() + "/" + (d.getMonth() + 1)
}

const PersonalExams = ({ onDateClick }: { onDateClick: (date: string) => void }) => {
  const courseInfo = useCourseInfo()
  const [dibIt] = useDibIt()

  const currentCourses = (dibIt.courses ?? {})[dibIt.semester ?? ""] ?? []

  const examDates = collectExams(
    currentCourses.filter(course => isCourseScheduled(course, courseInfo[course.id])),
    courseInfo,
  )
  const dateToExams: Record<string, CourseExam[]> = {}
  for (const exam of examDates) {
    (dateToExams[exam.key] ??= []).push(exam)
  }
  const firstExam = examDates.length > 0 ? examDates[0].date : undefined
  const lastExam =
    examDates.length > 0 ? examDates[examDates.length - 1].date : undefined

  if (!firstExam) {
    return <Text c="dimmed" my="md">אין מבחנים להצגה. בחרו קבוצות לימוד בקורסים שבמערכת.</Text>
  }

  return (
    <div
      className="adaptive-flex"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          marginTop: 20,
          marginBottom: 20,
        }}
      >
        {examDates.map(({ id, course, date, moed, type }) => (
          <p key={id}>
            {date.toLocaleString("he").split(",")[0]} ({DAYS[date.getDay()]})
            מועד {moed}' ב-
            <span style={{ color: getColor(course) }}>
              {courseInfo[course.id]?.name}
            </span>
            {type && ` · ${type}`}
          </p>
        ))}
        <h3 style={{ marginTop: 10, marginBottom: 10 }}>הפרשי ימים</h3>
        <div dir="ltr">
          {examDates.map(({ course, date, moed }, index) => (
            <React.Fragment key={index}>
              <Tooltip label={courseInfo[course.id]?.name}>
                <div
                  key={index}
                  style={{
                    backgroundColor: getColor(course),
                    display: "inline-block",
                    padding: 5,
                    paddingRight: 10,
                    paddingLeft: 10,
                    borderRadius: 10,
                  }}
                >
                  {index === 0
                    ? stringifyDate(date)
                    : Math.round(
                        (date.getTime() - examDates[index - 1].date.getTime()) /
                          MILLISECONDS_IN_DAY
                      )}
                </div>
              </Tooltip>

              {index !== examDates.length - 1 && (
                <span
                  style={{
                    marginRight:
                      moed !== examDates[index + 1]?.moed ? 10 : undefined,
                    marginLeft:
                      moed !== examDates[index + 1]?.moed ? 10 : undefined,
                  }}
                >
                  →
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
      <Calendar
        firstDayOfWeek={0}
        weekendDays={[]}
        getDayProps={(day) => ({ onClick: () => onDateClick(day), "aria-label": `חיפוש מבחנים בתאריך ${day}` })}
        maxLevel="month"
        defaultDate={firstExam}
        minDate={firstExam}
        maxDate={lastExam}
        monthLabelFormat={(m) =>
          `${MONTHS[dayjs(m).month()]} ${dayjs(m).year()}`
        }
        weekdayFormat={(d) => DAY_LETTERS[dayjs(d).day()] + "'"}
        renderDay={(d) => {
          const day = dayjs(d).date()
          const exams = dateToExams[d]
          if (exams !== undefined) {
            if (exams.length > 1) {
              return (
                <Tooltip
                  label={
                    "התנגשות בין " +
                    exams.map((e) => courseInfo[e.course.id]?.name).join(", ")
                  }
                >
                  <div
                    style={{
                      border: "3px solid red",
                      width: 30,
                      height: 30,
                      textAlign: "center",
                      padding: 2,
                      borderRadius: 5,
                    }}
                  >
                    {day}
                  </div>
                </Tooltip>
              )
            } else {
              return (
                <Tooltip
                  label={`${courseInfo[exams[0].course.id]?.name} (מועד ${
                    exams[0].moed
                  })`}
                >
                  <div
                    style={{
                      backgroundColor: getColor(exams[0].course),
                      color: "white",
                      width: 30,
                      height: 30,
                      textAlign: "center",
                      padding: 5,
                      borderRadius: 5,
                    }}
                  >
                    {day}
                  </div>
                </Tooltip>
              )
            }
          }

          return <div>{day}</div>
        }}
      />
    </div>
  )
}

const Exams = () => {
  const [searchDate, setSearchDate] = useState<string | null>(null)
  return (
    <>
      <Group justify="flex-end" className="dont-print">
        <Button
          variant="subtle" color="gray"
          size="sm"
          onClick={() => setSearchDate(searchDate === null ? "" : null)}
        >
          {searchDate === null
            ? "חיפוש קורסים לפי תאריך בחינה"
            : "חזרה למבחנים שלי"}
        </Button>
      </Group>
      {searchDate === null ? (
        <PersonalExams onDateClick={setSearchDate} />
      ) : (
        <ExamSearch initialDate={searchDate} />
      )}
    </>
  )
}
export default Exams
