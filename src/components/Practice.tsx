import { useMemo } from "react"
import { assertCourseCatalog, importSemesterCourses } from "../catalog"
import {
  Accordion,
  Alert,
  Button,
  Badge,
  Checkbox,
  Loader,
  Menu,
  Tooltip,
  Text,
} from "@mantine/core"
import { useCourseInfo } from "../CourseInfoContext"
import { useURLValue } from "../hooks"
import { DibItCourse, useDibIt } from "../models"
import { formatSemester, getColor } from "../utilities"
import { collectExams, isCourseScheduled } from "../exams"

const PracticeInfo = ({
  course,
  semester,
  gradeInfo,
}: {
  course: DibItCourse
  semester: string
  gradeInfo: any
}) => {
  const [source, loadingSemesterInfo, semesterLoad] = useURLValue<SemesterCourses>(
    `https://arazim-project.com/data/courses-${semester}.json`, assertCourseCatalog,
  )

  const semesterInfo = useMemo(() => importSemesterCourses(semester, source), [semester, source])
  if (semesterLoad.failed) return <Button variant="subtle" color="gray" size="compact-xs" onClick={semesterLoad.retry}>טעינת פרטי הסמסטר נכשלה — ניסיון נוסף</Button>
  if (loadingSemesterInfo) return <span role="status" aria-label="טוען פרטי סמסטר"><Loader size="xs" /></span>

  const mean = ((((gradeInfo ?? {})[course.id] ?? {})[semester] ?? {})["00"] ??
    [])[0]?.mean
  const groups = [...semesterInfo[course.id]?.groups.values() ?? []].flatMap(group => group.status === "ready" ? [group.data] : [])
  const lectureGroups = groups.filter(group => group.lessons?.some(lesson => lesson.type === "שיעור"))
  const lectureNames = lectureGroups.flatMap(group => group.lecturer?.split(",").map(name => name.trim()).filter(Boolean) ?? [])
  const lecturers = [...new Set(lectureNames.length ? lectureNames : groups
    .flatMap(group => group.lecturer?.split(",").map(name => name.trim()).filter(Boolean) ?? []))].sort().join(", ")
  const lecturersString = lecturers ? ` (${lecturers})` : ""
  const examLinks = semesterInfo[course.id]?.exam_links ?? []
  const linksString =
    examLinks.length === 1
      ? "קישור 1 למודל"
      : `${examLinks.length} קישורים למודל`

  return (
    <>
      <span>
        {formatSemester(semester)}
        {lecturersString}
      </span>
      {examLinks.length !== 0 && (
        <Menu>
          <Menu.Target>
            <Badge
              component="button"
              type="button"
              leftSection={<i className="fa-solid fa-file-pdf" aria-hidden="true" />}
              mr="xs"
              style={{ cursor: "pointer" }}
            >
              {linksString}
            </Badge>
          </Menu.Target>

          <Menu.Dropdown>
            {examLinks.map((examLink, index) => (
              <Tooltip
                label='זהו קישור למאגר הבחינות במודל. עליכם להיות מחוברים למודל, אחרת תופיע השגיאה "לא נמצאו כאן אורחים"'
                key={index}
              >
                <Menu.Item
                  component="a"
                  href={examLink}
                  leftSection={<i className="fa-solid fa-file-pdf" />}
                  target="_blank"
                >
                  {
                    decodeURIComponent(examLink.split("/").reverse()[0]).split(
                      ".pdf"
                    )[0]
                  }
                </Menu.Item>
              </Tooltip>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
      {mean !== undefined && mean !== 0 && (
        <Badge
          mr="xs"
          color="gray"
          leftSection={<i className="fa-solid fa-chart-line" />}
        >
          ממוצע: {mean.toFixed(2)}
        </Badge>
      )}

    </>
  )
}

const Practice = () => {
  const courseInfo = useCourseInfo()
  const [allTimeCourseInfo, loadingCourses, courseLoad] = useURLValue<AllTimeCourses>(
    "https://arazim-project.com/data/courses.json"
  )
  const [gradeInfo, loadingGrades, gradeLoad] = useURLValue<any>(
    "https://arazim-project.com/data/grades.json"
  )

  const [dibIt, setDibIt] = useDibIt()

  const currentCourses = (dibIt.courses ?? {})[dibIt.semester ?? ""] ?? []

  let examDates = collectExams(
    currentCourses.filter(course => isCourseScheduled(course, courseInfo[course.id])),
    courseInfo,
  )
  const seenCourses = new Set<string>()
  examDates = examDates.filter((exam) => {
    const exists = seenCourses.has(exam.course.id)
    seenCourses.add(exam.course.id)
    return !exists
  })

  if (courseLoad.failed || gradeLoad.failed) return <Alert color="red" role="alert">
    לא ניתן לטעון את מאגר המבחנים לתרגול.
    <Button variant="subtle" color="gray" onClick={() => { courseLoad.retry(); gradeLoad.retry() }}>ניסיון נוסף</Button>
  </Alert>
  if (loadingCourses || loadingGrades) return <div role="status" aria-label="טוען מבחנים לתרגול"><Loader size="sm" /></div>
  if (!examDates.length) return <Text c="dimmed" p="md">אין מבחנים לתרגול בקורסים שנבחרו. בחרו קבוצות בקורסים עם מועדי מבחנים בסמסטר הנוכחי.</Text>

  return (
    <Accordion
      multiple
      value={dibIt.openedPracticeCourses ?? []}
      onChange={(openedPracticeCourses) =>
        setDibIt({ ...dibIt, openedPracticeCourses })
      }
    >
      {examDates.map((exam) => {
        const totalPracticed =
          (dibIt.practicedExams ?? {})[exam.course.id]?.length ?? 0
        const totalPracticedString =
          totalPracticed === 1
            ? "תורגל מבחן אחד"
            : `תורגלו ${totalPracticed} מבחנים`
        return (
          <Accordion.Item key={exam.course.id} value={exam.course.id}>
            <Accordion.Control style={{ color: getColor(exam.course) }}>
              {courseInfo[exam.course.id]?.name} ({exam.course.id})
            </Accordion.Control>
            <Accordion.Panel>
              <span style={{ marginBottom: 10, fontWeight: "bold" }}>
                סה״כ {totalPracticedString}!
              </span>
              {(dibIt.openedPracticeCourses?.includes(exam.course.id) ? allTimeCourseInfo[exam.course.id]?.semesters ?? [] : []).map(
                (semester, semesterIndex) => {
                  return (
                    <div
                      key={semesterIndex}
                      style={{
                        marginBottom: 5,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <Checkbox
                        display="inline-block"
                        label="מועד א׳"
                        ml="xs"
                        checked={
                          (dibIt.practicedExams ?? {})[
                            exam.course.id
                          ]?.includes(semester + "a") ?? false
                        }
                        onChange={(e) => {
                          if (!dibIt.practicedExams) {
                            dibIt.practicedExams = {}
                          }
                          if (!dibIt.practicedExams[exam.course.id]) {
                            dibIt.practicedExams[exam.course.id] = []
                          }
                          if (e.currentTarget.checked) {
                            dibIt.practicedExams[exam.course.id].push(
                              semester + "a"
                            )
                          } else {
                            dibIt.practicedExams[exam.course.id] =
                              dibIt.practicedExams[exam.course.id].filter(
                                (s) => s !== semester + "a"
                              )
                          }
                          setDibIt({ ...dibIt })
                        }}
                      />
                      <Checkbox
                        display="inline-block"
                        label="מועד ב׳"
                        ml="xs"
                        checked={
                          (dibIt.practicedExams ?? {})[
                            exam.course.id
                          ]?.includes(semester + "b") ?? false
                        }
                        onChange={(e) => {
                          if (!dibIt.practicedExams) {
                            dibIt.practicedExams = {}
                          }
                          if (!dibIt.practicedExams[exam.course.id]) {
                            dibIt.practicedExams[exam.course.id] = []
                          }
                          if (e.currentTarget.checked) {
                            dibIt.practicedExams[exam.course.id].push(
                              semester + "b"
                            )
                          } else {
                            dibIt.practicedExams[exam.course.id] =
                              dibIt.practicedExams[exam.course.id].filter(
                                (s) => s !== semester + "b"
                              )
                          }
                          setDibIt({ ...dibIt })
                        }}
                      />
                      <PracticeInfo gradeInfo={gradeInfo} course={exam.course} semester={semester} />
                    </div>
                  )
                }
              )}
            </Accordion.Panel>
          </Accordion.Item>
        )
      })}
    </Accordion>
  )
}

export default Practice
