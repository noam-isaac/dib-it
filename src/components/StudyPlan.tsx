import {
  allTimeCoursesSchema,
  booleanSchema,
  generalInfoSchema,
  semesterPlansSchema,
} from "../schemas"
import {
  Autocomplete,
  Badge,
  Button,
  Loader,
  Select,
  Switch,
  Tooltip,
} from "@mantine/core"
import { useCourseInfo } from "../CourseInfoContext"
import hash from "../color-hash"
import { useLocalStorage, useURLValue } from "../hooks"
import { useDibIt } from "../models"
import {
  checkPrerequisites,
  FIRST_SEMESTER,
  formatSemester,
  getClosestValue,
  getPastAndPresentCourses,
  MILLISECONDS_IN_DAY,
  parseDateString,
} from "../utilities"

const StudyPlan = () => {
  const [dibIt, setDibIt] = useDibIt()
  const [sorted, setSorted] = useLocalStorage({
    schema: booleanSchema,
    key: "Study Plan Sorted",
    defaultValue: false,
  })
  const [hideTakenCourses, setHideTakenCourses] = useLocalStorage({
    schema: booleanSchema,
    key: "Hide Taken Courses",
    defaultValue: false,
  })
  const courseInfo = useCourseInfo()
  const [allTimeCourseInfo, loadingAllTimeCourseInfo] =
    useURLValue("https://arazim-project.com/data/courses.json", allTimeCoursesSchema, {})
  const [generalInfo] = useURLValue(
    "https://arazim-project.com/data/info.json",
    generalInfoSchema,
    {},
  )
  const [plans] = useURLValue(
    dibIt.degreeStartYear
      ? `https://arazim-project.com/data/plans-${dibIt.degreeStartYear}.json`
      : undefined,
    semesterPlansSchema,
    {},
  )

  if (!dibIt.semester) return null
  if (!dibIt.courses) {
    dibIt.courses = {}
  }
  const currentCourses = (dibIt.courses[dibIt.semester] ??= [])
  const selectedPlan = plans[dibIt.school ?? ""]?.[dibIt.studyPlan ?? ""] ?? {}

  let courseDates: number[] = []
  for (const course of currentCourses) {
    const examDates = courseInfo[course.id]?.exams
    if (examDates?.length !== undefined && examDates.length > 0) {
      for (const date of examDates) {
        const parsedDate = parseDateString(date.date)
        if (parsedDate) {
          courseDates.push(parsedDate.getTime())
        }
      }
    }
  }

  courseDates.sort()

  const getDayDifference = (courseId: string) => {
    const date = courseInfo[courseId]?.exams
    if (!date || date.length === 0 || date[0]?.date === "") {
      return
    }
    const time = parseDateString(date[0]?.date)?.getTime() ?? 0
    const closest = getClosestValue(time, courseDates)
    if (closest === undefined) return undefined
    const difference = Math.round(
      Math.abs(closest - time) / MILLISECONDS_IN_DAY
    )
    return difference
  }

  const getSortingValue = (courseId: string) => {
    if (currentCourses.some((course) => course.id === courseId)) {
      return 99999999999
    }

    const date = courseInfo[courseId]?.exams ?? []

    if (date.length === 0) {
      return -100000000000
    }

    if (courseDates.length === 0) {
      return 0
    }

    const time = parseDateString(date[0]?.date)?.getTime() ?? 0
    const closest = getClosestValue(time, courseDates)
    if (closest === undefined) return 0
    const difference = Math.abs(closest - time)
    return -difference
  }

  const possiblySortAndFilter = (a: string[]) => {
    let result = [...a]
    if (hideTakenCourses) {
      result = result.filter(
        (x) => courseIdToFirstSemesterTaken[x] === undefined
      )
    }

    if (sorted) {
      result = result
        .filter((x) => courseInfo[x] !== undefined)
        .sort((x, y) => getSortingValue(x) - getSortingValue(y))
    }

    return result
  }

  const courseIdToFirstSemesterTaken: Record<string, string> = {}
  for (const semester in dibIt.courses) {
    for (const course of dibIt.courses[semester] ?? []) {
      courseIdToFirstSemesterTaken[course.id] = semester
    }
  }

  const [pastCourses, pastAndPresentCourses] = getPastAndPresentCourses(
    dibIt,
    dibIt.semester
  )

  return (
    <div
      style={{
        overflow: "auto",
        paddingTop: 10,
        marginBottom: 10,
        marginLeft: 10,
      }}
    >
      {loadingAllTimeCourseInfo && (
        <p
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 10,
          }}
        >
          <Loader size="sm" ml="xs" /> טוען מידע על קורסים מכל השנים...
        </p>
      )}
      <Select
        mt="xs"
        allowDeselect
        label="שנת התחלת התואר"
        leftSection={<i className="fa-solid fa-calendar" />}
        value={dibIt.degreeStartYear || null}
        onChange={(v) => setDibIt({ ...dibIt, degreeStartYear: v ?? "" })}
        data={[
          ...new Set(
            Object.keys(generalInfo.semesters ?? {})
              .sort()
              .filter((semester) => semester >= FIRST_SEMESTER)
              .map((key) => key.slice(0, 4))
          ),
        ].sort()}
      />
      <Select
        mt="xs"
        label="פקולטה"
        leftSection={<i className="fa-solid fa-school" />}
        data={Object.keys(plans).sort()}
        value={dibIt.school ?? null}
        onChange={(v) => {
          if (v) {
            dibIt.school = v
            setDibIt({ ...dibIt })
          }
        }}
      />
      {plans[dibIt.school ?? ""] !== undefined && (
        <Autocomplete
          mt="xs"
          size="md"
          label="תוכנית לימוד"
          leftSection={<i className="fa-solid fa-book" />}
          data={Object.keys(plans[dibIt.school ?? ""] ?? {}).sort()}
          value={dibIt.studyPlan ?? ""}
          onChange={(v) => {
            dibIt.studyPlan = v
            setDibIt({ ...dibIt })
          }}
          limit={20}
          maxDropdownHeight={200}
        />
      )}

      <Switch
        mt="xs"
        label="הסתר קורסים שנלקחו"
        checked={hideTakenCourses}
        onChange={(e) => setHideTakenCourses(e.currentTarget.checked)}
      />

      <Switch
        mt="xs"
        label="הצג רק קורסים שעוברים בסמסטר הנבחר ומיין לפי השתלבות בתקופת מבחנים"
        checked={sorted}
        onChange={(e) => setSorted(e.currentTarget.checked)}
      />

      {Object.keys(selectedPlan).map(
          (key) => {
            const textColor = hash.hsl(key)[2] > 0.5 ? "black" : "white"
            const categoryCourses = selectedPlan[key]

            if (!categoryCourses?.courses) {
              return <></>
            }

            return (
              <div
                key={key}
                style={{
                  borderColor: hash.hex(key),
                  borderWidth: 5,
                  borderStyle: "solid",
                  backgroundColor: hash.hex(key) + "bb",
                  color: textColor,
                  marginTop: 10,
                  borderRadius: 10,
                  padding: 5,
                  paddingRight: 10,
                  paddingLeft: 10,
                }}
              >
                <h2 style={{ marginBottom: 10 }}>{key}</h2>
                {possiblySortAndFilter(
                  Object.keys(categoryCourses.courses)
                ).map((courseId: string) => {
                  const info =
                    courseInfo[courseId] ?? allTimeCourseInfo[courseId]
                  const name = info?.name
                    ? `${info.name} (${courseId})`
                    : `קורס מספר ${courseId}`
                  const difference = getDayDifference(courseId)
                  const included = currentCourses.some(
                    (course) => course.id === courseId
                  )
                  const prerequisitesIssue = checkPrerequisites(
                    courseInfo[courseId]?.prerequisites,
                    pastCourses,
                    pastAndPresentCourses,
                    (courseId) =>
                      `${allTimeCourseInfo[courseId]?.name} (${courseId})`
                  )

                  return (
                    <div
                      key={courseId}
                      style={{ marginTop: 5, marginBottom: 5 }}
                    >
                      <span style={{ color: textColor }}>{name}</span>

                      {courseInfo[courseId] !== undefined && !included && (
                        <Button
                          variant="default"
                          style={{ marginInlineStart: 5 }}
                          leftSection={<i className="fa-solid fa-plus" />}
                          size="xs"
                          onClick={() => {
                            currentCourses.push({ id: courseId })
                            setDibIt({ ...dibIt })
                          }}
                        >
                          הוספה
                        </Button>
                      )}

                      {included && (
                        <Badge
                          mr={5}
                          variant="filled"
                          color="green"
                          leftSection={<i className="fa-solid fa-check" />}
                        >
                          נמצא במערכת
                        </Badge>
                      )}

                      {!included &&
                        courseIdToFirstSemesterTaken[courseId] !==
                          undefined && (
                          <Badge
                            mr={5}
                            variant="filled"
                            color="green"
                            leftSection={<i className="fa-solid fa-check" />}
                          >
                            נלקח בסמסטר{" "}
                            {formatSemester(
                              courseIdToFirstSemesterTaken[courseId]
                            )}
                          </Badge>
                        )}

                      {prerequisitesIssue !== undefined && (
                        <Tooltip
                          label={
                            "לפי הקורסים שרשומים בסמסטרים קודמים, חסר " +
                            prerequisitesIssue
                          }
                        >
                          <Badge
                            mr={5}
                            variant="filled"
                            color="red"
                            leftSection={<i className="fa-solid fa-xmark" />}
                          >
                            חסרות דרישות קדם
                          </Badge>
                        </Tooltip>
                      )}

                      {!sorted &&
                        !included &&
                        courseInfo[courseId] === undefined && (
                          <Badge
                            mr={5}
                            color="red"
                            leftSection={<i className="fa-solid fa-xmark" />}
                          >
                            לא עובר בסמסטר הנבחר
                          </Badge>
                        )}

                      {courseInfo[courseId] !== undefined &&
                        courseInfo[courseId]?.exams?.filter(
                          (x) => x.date !== ""
                        ).length === 0 && (
                          <Badge
                            mr={5}
                            variant="filled"
                            color="green"
                            leftSection={<i className="fa-solid fa-check" />}
                          >
                            אין מבחן
                          </Badge>
                        )}

                      {courseInfo[courseId] !== undefined &&
                        difference !== undefined &&
                        !isNaN(difference) &&
                        !included && (
                          <Badge
                            mr={5}
                            variant="default"
                            leftSection={<i className="fa-solid fa-clock" />}
                          >
                            הפרש ימים מהמבחן הכי קרוב: {difference}
                          </Badge>
                        )}
                    </div>
                  )
                })}
              </div>
            )
          }
        )}
    </div>
  )
}

export default StudyPlan
