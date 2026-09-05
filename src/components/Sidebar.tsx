import {
  ActionIcon,
  Autocomplete,
  Loader,
  Menu,
  Select,
  Tooltip,
} from "@mantine/core"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { useEffect, useState } from "react"
import { useCourseInfo } from "../CourseInfoContext"
import { useLocalStorage, useURLValue } from "../hooks"
import { DibItCourse, getWorkspace, setWorkspace, useDibIt } from "../models"
import { isScheduleBackup } from "../scheduleBackup"
import { getICS } from "../serialize"
import {
  downloadFile,
  FIRST_SEMESTER,
  formatSemesterInHebrew,
  uploadJson,
} from "../utilities"
import AutoBidModal from "./AutoBidModal"
import CourseCard from "./CourseCard"
import GoogleSaveButtons from "./GoogleSaveButtons"
import RegistrationModal from "./RegistrationModal"
import PlanSelector from "./PlanSelector"

const Sidebar = ({ prefetching }: { prefetching: boolean }) => {
  const courseInfo = useCourseInfo()
  const [search, setSearch] = useState("")
  const [compactView, setCompactView] = useLocalStorage<boolean>({
    key: "Sidebar Compact",
    defaultValue: false,
  })
  const [dibIt, setDibIt] = useDibIt()
  const [generalInfo] = useURLValue<GeneralInfo>(
    "https://arazim-project.com/data/info.json"
  )

  let currentCourses: DibItCourse[] = []
  useEffect(() => {
    if (!dibIt.semester) {
      dibIt.semester = generalInfo.currentSemester
    }
    setDibIt({ ...dibIt })
  }, [generalInfo])

  if (!dibIt.semester) {
    return <></>
  }

  if (
    dibIt.semester !== undefined &&
    dibIt.courses !== undefined &&
    dibIt.courses[dibIt.semester] !== undefined
  ) {
    currentCourses = dibIt.courses[dibIt.semester]
  }
  const semester = dibIt.semester

  return (
    <div
      id="sidebar"
      className="dont-print"
      style={{
        flex: "none",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        padding: 10,
        transition: "300ms ease-in-out",
      }}
    >
      {prefetching && (
        <p style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <Loader size="sm" ml="xs" /> טוען מראש את כל הקורסים כדי להאיץ את
          החיפוש...
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label htmlFor="semester-selector">סמסטר:</label>
        <Select
          id="semester-selector"
          style={{ flex: 1, minWidth: 0 }}
          value={semester}
          onChange={(v) => {
            if (v) {
              dibIt.semester = v
              setDibIt({ ...dibIt })
            }
          }}
          data={Object.keys(generalInfo.semesters ?? {})
            .sort()
            .filter((semester) => semester >= FIRST_SEMESTER)
            .map((key) => ({
              value: key,
              label: formatSemesterInHebrew(key),
            }))}
          leftSection={<i className="fa-solid fa-cloud-moon" />}
        />

        <Menu>
          <Menu.Target>
            <Tooltip label="פעולות">
              <ActionIcon size="lg" variant="light" aria-label="פעולות">
                <i className="fa-solid fa-ellipsis-vertical" />
              </ActionIcon>
            </Tooltip>
          </Menu.Target>

          <Menu.Dropdown style={{ zIndex: 100000 }}>
            <Menu.Item
              leftSection={<i className="fa-solid fa-calendar-days" aria-hidden="true" />}
              onClick={() => modals.open({ title: "מערכות שעות", centered: true, children: <PlanSelector /> })}
            >
              מערכות שעות
            </Menu.Item>
            <Menu.Divider />
            <Tooltip label="הורידו קובץ JSON שמכיל את כל המערכות שלכם">
              <Menu.Item
                color="cyan"
                leftSection={<i className="fa-solid fa-download" />}
                onClick={() =>
                  downloadFile(
                    "dibit.json",
                    "data:text/json;charset=utf-8," +
                      encodeURIComponent(JSON.stringify(getWorkspace()))
                  )
                }
              >
                גיבוי
              </Menu.Item>
            </Tooltip>
            <Menu.Item
              color="cyan"
              leftSection={<i className="fa-solid fa-upload" />}
              onClick={async () => {
                try {
                  const state = await uploadJson()
                  if (!isScheduleBackup(state)) throw new Error("הקובץ אינו גיבוי תקין של Dib It.")
                  setWorkspace(state)
                } catch (error) {
                  notifications.show({ title: "השחזור נכשל", message: error instanceof Error ? error.message : "לא ניתן לקרוא את הקובץ.", color: "red" })
                }
              }}
            >
              שחזור
            </Menu.Item>

            <GoogleSaveButtons />

            <Menu.Item
              color="blue"
              leftSection={<i className="fa-solid fa-calendar" />}
              onClick={async () => {
                try {
                  const ics = await getICS(semester, currentCourses, courseInfo)
                  downloadFile(
                    "calendar.ics",
                    "data:text/calendar;charset=utf-8," +
                      encodeURIComponent(ics)
                  )
                  notifications.show({
                    title: "הייצוא הושלם בהצלחה",
                    message:
                      "כעת עליכם לבצע ייבוא לקובץ ה-ICS שהורד. לחצו כאן כדי לפתוח את חלון הייבוא של Google Calendar.",
                    style: { direction: "rtl" },
                    icon: <i className="fa-solid fa-check" />,
                    color: "green",
                    styles: { body: { cursor: "pointer" } },
                    onClick: () => {
                      window.open(
                        "https://calendar.google.com/calendar/u/0/r/settings/export",
                        "_blank"
                      )
                    },
                  })
                } catch (error) {
                  notifications.show({
                    title: "הייצוא נכשל",
                    message:
                      error instanceof Error
                        ? error.message
                        : "לא ניתן לטעון את תאריכי הסמסטר. נסו שוב.",
                    color: "red",
                  })
                }
              }}
            >
              ייצוא ל-Apple/Google Calendar
            </Menu.Item>
            <Menu.Item
              color="blue"
              leftSection={<i className="fa-solid fa-file-word" />}
              onClick={() =>
                modals.open({
                  title: "טופס רישום לקורסים",
                  size: "lg",
                  centered: true,
                  children: (
                    <RegistrationModal
                      semester={semester}
                      courses={currentCourses}
                      info={courseInfo}
                    />
                  ),
                })
              }
            >
              יצירת טופס רישום ב-Word
            </Menu.Item>
            <Menu.Item
              leftSection={<i className="fa-solid fa-print" />}
              color="violet"
              onClick={window.print}
            >
              הדפסה/שמירה כ-PDF
            </Menu.Item>

            <Menu.Item
              leftSection={<i className="fa-solid fa-gavel" />}
              color="orange"
              onClick={() =>
                modals.open({
                  title: "המלצות בידינג אוטומטיות",
                  children: <AutoBidModal courses={currentCourses} />,
                  centered: true,
                })
              }
            >
              המלצות בידינג אוטומטיות
            </Menu.Item>

            <Menu.Item
              onClick={() => setCompactView(!compactView)}
              leftSection={<i className="fa-solid fa-eye" />}
            >
              שינוי תצוגה ל{compactView ? "מלאה" : "קומפקטית"}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      <Autocomplete
        size="md"
        mt={10}
        mb={10}
        value={search}
        onChange={(courseName) => {
          const split = courseName.split("(")
          if (split.length < 2) {
            setSearch(courseName)
            return
          }
          const courseId = split[split.length - 1].split(")")[0]
          if (courseInfo[courseId] !== undefined) {
            setSearch("")
            if (!dibIt.courses) {
              dibIt.courses = {}
            }
            if (!dibIt.courses[semester]) {
              dibIt.courses[semester] = []
            }
            dibIt.courses[semester].push({ id: courseId })
            setDibIt({ ...dibIt })
          } else {
            setSearch(courseName)
          }
        }}
        data={Object.keys(courseInfo)
          .filter((id) => !currentCourses.some((course) => course.id === id))
          .map((courseId) => `${courseInfo[courseId]?.name} (${courseId})`)
          .sort()}
        leftSection={<i className="fa-solid fa-search" />}
        placeholder="חיפוש קורסים להוספה"
        limit={20}
        maxDropdownHeight={300}
      />

      {currentCourses.map((_, index) => (
        <CourseCard
          key={index}
          index={index}
          semester={semester}
          compactView={compactView}
        />
      ))}
    </div>
  )
}

export default Sidebar
