import {
  Anchor,
  Button,
  Collapse,
  Group,
  Pagination,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core"
import { useMemo, useState } from "react"
import { useCourseInfo } from "../CourseInfoContext"
import { collectExams, filterExamDates, isCourseScheduled } from "../exams"
import { getDibIt, useDibIt } from "../models"
import { getColor } from "../utilities"

const PAGE_SIZE = 30

const ExamSearch = ({ initialDate }: { initialDate: string }) => {
  const info = useCourseInfo()
  const [dibIt, setDibIt] = useDibIt()
  const [start, setStart] = useState(initialDate)
  const [end, setEnd] = useState("")
  const [query, setQuery] = useState("")
  const [faculty, setFaculty] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [page, setPage] = useState(1)
  const semester = dibIt.semester ?? ""
  const currentCourses = dibIt.courses?.[semester] ?? []
  const exams = useMemo(
    () =>
      collectExams(
        Object.keys(info).map((id) => ({ id })),
        info,
      ),
    [info],
  )
  const faculties = useMemo(
    () =>
      [
        ...new Set(
          Object.values(info)
            .map((course) => course?.faculty)
            .filter((value): value is string => !!value),
        ),
      ].sort(),
    [info],
  )
  const results = filterExamDates(exams, start, end).filter((exam) => {
    const text =
      `${info[exam.course.id]?.name ?? ""} ${exam.course.id}`.toLowerCase()
    return (
      (!faculty || info[exam.course.id]?.faculty === faculty) &&
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .every((word) => text.includes(word))
    )
  })
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const visiblePage = Math.min(page, totalPages)
  const addCourse = (id: string) => {
    const latest = getDibIt()
    const courses = latest.courses?.[semester] ?? []
    if (!courses.some((course) => course.id === id)) {
      setDibIt({
        ...latest,
        courses: { ...latest.courses, [semester]: [...courses, { id }] },
      })
    }
    requestAnimationFrame(() =>
      document
        .getElementById(`course-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    )
  }
  return (
    <Stack gap="sm" className="exam-search">
      <Text size="sm" c="dimmed">
        חיפוש בכל הקורסים של הסמסטר הנבחר. ליום יחיד מלאו רק את השדה הראשון;
        לטווח מלאו גם תאריך סיום.
      </Text>
      <Group align="flex-end" className="dont-print">
        <TextInput
          type="date"
          label="תאריך / מתאריך"
          value={start}
          onChange={(e) => {
            setStart(e.currentTarget.value)
            setPage(1)
          }}
        />
        <TextInput
          type="date"
          label="עד תאריך (כולל)"
          value={end}
          onChange={(e) => {
            setEnd(e.currentTarget.value)
            setPage(1)
          }}
        />
        <Button
          variant="subtle"
          size="xs"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "הסתרת סינון נוסף" : "סינון לפי קורס או פקולטה"}
        </Button>
        {(start || end || query || faculty) && (
          <Button
            variant="subtle"
            size="xs"
            onClick={() => {
              setStart("")
              setEnd("")
              setQuery("")
              setFaculty(null)
              setPage(1)
            }}
          >
            ניקוי
          </Button>
        )}
      </Group>
      <Collapse in={advanced} className="dont-print">
        <Group grow align="flex-end">
          <TextInput
            label="שם או מספר קורס"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
              setPage(1)
            }}
          />
          <Select
            label="פקולטה"
            placeholder="כל הפקולטות"
            clearable
            searchable
            data={faculties}
            value={faculty}
            onChange={(value) => {
              setFaculty(value)
              setPage(1)
            }}
          />
        </Group>
      </Collapse>
      <Text size="sm" c="dimmed" role="status">
        {new Set(results.map((exam) => exam.course.id)).size} קורסים ·{" "}
        {results.length} מבחנים
      </Text>
      {results.length === 0 && <Text>לא נמצאו מבחנים בתאריכים שנבחרו.</Text>}
      <div>
        {results
          .slice((visiblePage - 1) * PAGE_SIZE, visiblePage * PAGE_SIZE)
          .map((exam) => {
            const selected = currentCourses.find(
              (course) => course.id === exam.course.id,
            )
            return (
              <Group
                className="exam-search-row"
                key={JSON.stringify([
                  exam.course.id,
                  exam.key,
                  exam.moed,
                  exam.type,
                  exam.hour,
                ])}
                justify="space-between"
                gap="xs"
                wrap="wrap"
              >
                <div>
                  <Text size="sm">
                    {exam.date.toLocaleDateString("he-IL")} {exam.hour}{" "}
                    {exam.moed && `· מועד ${exam.moed}׳`} ·{" "}
                    <span style={{ color: getColor(selected ?? exam.course) }}>
                      {info[exam.course.id]?.name}
                    </span>
                  </Text>
                  <Text size="xs" c="dimmed">
                    {exam.course.id}
                    {selected &&
                    isCourseScheduled(selected, info[exam.course.id])
                      ? " · במערכת שלי"
                      : ""}
                  </Text>
                </div>
                <Anchor
                  component="button"
                  size="xs"
                  onClick={() => addCourse(exam.course.id)}
                >
                  {selected ? "בחירת קבוצות" : "הוספת קורס"}
                </Anchor>
              </Group>
            )
          })}
      </div>
      {totalPages > 1 && (
        <Pagination
          size="sm"
          total={totalPages}
          value={visiblePage}
          onChange={setPage}
        />
      )}
    </Stack>
  )
}
export default ExamSearch
