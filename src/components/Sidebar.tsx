import {
  ActionIcon,
  Autocomplete,
  Button,
  Menu,
  Select,
  Tooltip,
} from "@mantine/core"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { useState } from "react"
import { useCourseInfo } from "../CourseInfoContext"
import { useLocalStorage, useURLValue } from "../hooks"
import { DibItCourse, setDibIt, useWorkspace } from "../models"
import { activePlanView } from "../plans"
import { getICS } from "../serialize"
import {
  downloadFile,
  downloadScheduleImage,
  FIRST_SEMESTER,
  formatSemesterInHebrew,
  uploadJson,
} from "../utilities"
import AutoBidModal from "./AutoBidModal"
import CourseCard from "./CourseCard"
import GoogleSaveButtons from "./GoogleSaveButtons"
import RegistrationModal from "./RegistrationModal"
import PlanSelector from "./PlanSelector"
import { downloadWorkspaceBackup, openScheduleRestore } from "./RestoreScheduleModal"

const Sidebar = () => {
  const courseInfo = useCourseInfo()
  const [search, setSearch] = useState("")
  const [exportingImage, setExportingImage] = useState(false)
  const [compactView, setCompactView] = useLocalStorage<boolean>({
    key: "Sidebar Compact",
    defaultValue: false,
  })
  const workspace = useWorkspace()
  const dibIt = activePlanView(workspace)
  const activePlan = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  const [generalInfo, , semesterLoad] = useURLValue<GeneralInfo>(
    "https://arazim-project.com/data/info.json"
  )

  let currentCourses: DibItCourse[] = []


  if (
    dibIt.semester !== undefined &&
    dibIt.courses !== undefined &&
    dibIt.courses[dibIt.semester] !== undefined
  ) {
    currentCourses = dibIt.courses[dibIt.semester]
  }
  const semester = dibIt.semester ?? ""

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
      {!!activePlan.pendingAnnualChanges?.length && (
        <p role="status" style={{ maxWidth: 300 }}>
          הבחירות נשמרו. סנכרון הקורסים השנתיים ממתין לטעינת נתוני השנה והסמסטרים.{" "}
          <button type="button" className="link text-accent" onClick={() => window.location.reload()}>ניסיון נוסף</button>
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label htmlFor="semester-selector">סמסטר:</label>
        <Select
          id="semester-selector"
          style={{ flex: 1, minWidth: 0 }}
          value={semester || null}
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
          leftSection={<i className="fa-solid fa-cloud-moon" aria-hidden="true" />}
        />

        <Menu>
          <Menu.Target>
            <Tooltip label="פעולות">
              <ActionIcon size="lg" variant="light" aria-label="פעולות">
                <i className="fa-solid fa-ellipsis-vertical" aria-hidden="true" />
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
                leftSection={<i className="fa-solid fa-download" aria-hidden="true" />}
                onClick={() => downloadWorkspaceBackup()}
              >
                גיבוי
              </Menu.Item>
            </Tooltip>
            <Menu.Item
              color="cyan"
              leftSection={<i className="fa-solid fa-upload" aria-hidden="true" />}
              onClick={async () => {
                try {
                  const state = await uploadJson()
                  openScheduleRestore(state, "file")
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
              leftSection={<i className="fa-solid fa-calendar" aria-hidden="true" />}
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
                    icon: <i className="fa-solid fa-check" aria-hidden="true" />,
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
              leftSection={<i className="fa-solid fa-file-word" aria-hidden="true" />}
              onClick={() =>
                modals.open({
                  title: "טופס רישום לקורסים",
                  size: "lg",
                  centered: true,
                  children: (
                    <RegistrationModal
                      planName={activePlan.name}
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
              leftSection={<i className="fa-solid fa-print" aria-hidden="true" />}
              color="violet"
              onClick={window.print}
            >
              הדפסה/שמירה כ-PDF
            </Menu.Item>
            {(!dibIt.tab || dibIt.tab === "schedule") && <Menu.Item
              leftSection={<i className="fa-regular fa-image" aria-hidden="true" />}
              color="violet"
              disabled={exportingImage}
              onClick={async () => {
                setExportingImage(true)
                try { await downloadScheduleImage(semester) }
                catch (error) {
                  notifications.show({ title: "שמירת התמונה נכשלה", message: error instanceof Error ? error.message : "נסו שוב.", color: "red" })
                } finally { setExportingImage(false) }
              }}
            >שמירת מערכת השעות כתמונה (PNG)</Menu.Item>}

            <Menu.Item
              leftSection={<i className="fa-solid fa-gavel" aria-hidden="true" />}
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
              leftSection={<i className="fa-solid fa-eye" aria-hidden="true" />}
            >
              שינוי תצוגה ל{compactView ? "מלאה" : "קומפקטית"}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      {semesterLoad.failed && <Button variant="subtle" size="compact-sm" onClick={semesterLoad.retry}>טעינת רשימת הסמסטרים נכשלה — ניסיון נוסף</Button>}
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
            if (currentCourses.some(course => course.id === courseId)) return
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
        leftSection={<i className="fa-solid fa-search" aria-hidden="true" />}
        placeholder="חיפוש קורסים להוספה"
        limit={20}
        maxDropdownHeight={300}
      />

      <div id="course-list">
      {currentCourses.map((course, index) => (
        <CourseCard
          key={course.id}
          index={index}
          semester={semester}
          compactView={compactView}
        />
      ))}
      </div>
    </div>
  )
}

export default Sidebar
