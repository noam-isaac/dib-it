import {
  ActionIcon,
  Alert,
  Text,
  Button,
  Checkbox,
  NumberInput,
  TextInput,
} from "@mantine/core"
import { useEffect, useState } from "react"
import autoBid, { getPossibleFaculties } from "../autoBid"
import { cachedFetch, useLocalStorage } from "../hooks"
import { DibItCourse } from "../models"

const AutoBidModal = ({ courses }: { courses: DibItCourse[] }) => {
  const [facultyPoints, setFacultyPoints] = useLocalStorage<
    { faculty: string; points?: number }[]
  >({ key: "Auto Bid Faculty Points", defaultValue: [] })
  const [loading, setLoading] = useState(false)
  const [possibleFaculties, setPossibleFaculties] = useState<Record<string, string[]>>({})
  const [error, setError] = useState("")
  const [results, setResults] = useState<
    Record<string, Record<string, number>>
  >({})

  const existingFaculties = facultyPoints
    .filter((p) => p.faculty.trim() && p.points && p.points > 0)
    .map((p) => p.faculty)

  useEffect(() => {
    setPossibleFaculties({})
    setResults({})
    setError("")
  }, [facultyPoints])

  const validInput = courses.length > 0 && facultyPoints.length > 0
    && facultyPoints.every(p => p.faculty.trim() && Number.isSafeInteger(p.points) && p.points! > 0)
    && new Set(existingFaculties).size === facultyPoints.length
  const assignedCourses = new Set(Object.values(results).flatMap(Object.keys))
  const unassigned = courses.filter(course => !assignedCourses.has(course.id))

  return (
    <>
      {facultyPoints.map(({ faculty, points }, index) => (
        <div
          style={{ display: "flex", alignItems: "center", marginBottom: 10 }}
          key={index}
        >
          <TextInput
            placeholder="מסלול"
            aria-label="מסלול בבידינג"
            disabled={loading}
            value={faculty}
            onChange={(e) => {
              facultyPoints[index].faculty = e.currentTarget.value
              setFacultyPoints([...facultyPoints])
            }}
          />
          <span style={{ flexGrow: 1 }} />
          <NumberInput
            mr={5}
            placeholder="נקודות"
            aria-label="נקודות בבידינג"
            disabled={loading}
            allowDecimal={false}
            value={points}
            min={0}
            onChange={(v) => {
              facultyPoints[index].points =
                typeof v === "number" ? v : undefined
              setFacultyPoints([...facultyPoints])
            }}
          />
          <ActionIcon
            aria-label="מחיקת מסלול בבידינג"
            disabled={loading}
            color="red"
            variant="subtle"
            mr={5}
            onClick={() => {
              facultyPoints.splice(index, 1)
              setFacultyPoints([...facultyPoints])
            }}
          >
            <i className="fa-solid fa-trash" aria-hidden="true" />
          </ActionIcon>
        </div>
      ))}
      <Button
        fullWidth
        disabled={loading}
        leftSection={<i className="fa-solid fa-plus" aria-hidden="true" />}
        onClick={() => setFacultyPoints([...facultyPoints, { faculty: "" }])}
        mb="xs"
      >
        הוספת מסלול בבידינג
      </Button>

      {Object.keys(possibleFaculties)
        .sort()
        .map((courseId, index) => (
          <div
            key={index}
            style={{ marginTop: 5, display: "flex", alignItems: "center" }}
          >
            <span>{courseId}</span>
            {existingFaculties.map((faculty, facultyIndex) => (
              <Checkbox
                disabled={loading}
                mr="auto"
                label={faculty}
                display="inline-block"
                key={facultyIndex}
                checked={possibleFaculties[courseId].includes(faculty)}
                onChange={(e) => {
                  if (e.currentTarget.checked) {
                    possibleFaculties[courseId].push(faculty)
                  } else {
                    possibleFaculties[courseId] = possibleFaculties[
                      courseId
                    ].filter((x) => x !== faculty)
                  }
                  setPossibleFaculties({ ...possibleFaculties })
                  setResults({})
                  setError("")
                }}
              />
            ))}
          </div>
        ))}

      {!validInput && <Text size="sm" c="dimmed">הוסיפו קורסים ומסלולים עם שמות שונים ותקציב נקודות שלם וחיובי.</Text>}
      {error && <Alert color="red" role="alert" mt="xs">{error}</Alert>}
      <Button
        loading={loading}
        disabled={!validInput}
        fullWidth
        mt="xs"
        leftSection={<i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />}
        onClick={async () => {
          setLoading(true)
          setError("")
          setResults({})
          try {
            const allTimeBiddingInfo = await cachedFetch<AllTimeBiddingInfo>(
              "https://arazim-project.com/data/bidding.json"
            )
            let newPossibleFaculties
            if (Object.keys(possibleFaculties).length === 0) {
              newPossibleFaculties = await getPossibleFaculties(
                courses,
                facultyPoints,
                allTimeBiddingInfo
              )
              setPossibleFaculties(newPossibleFaculties)
            } else {
              newPossibleFaculties = possibleFaculties
            }
            setResults(
              await autoBid(
                courses,
                facultyPoints,
                newPossibleFaculties,
                allTimeBiddingInfo
              )
            )
          } catch {
            setError("לא ניתן לחשב המלצות כרגע. נסו שוב.")
          } finally {
            setLoading(false)
          }
        }}
      >
        חישוב המלצות (2, 3 - שג׳ר!)
      </Button>
      {Object.keys(results).length > 0 && unassigned.length > 0 && <Alert color="yellow" mt="xs">
        לא חושבה המלצה לקורסים: {unassigned.map(course => course.id).join(", ")}. בדקו את שיוך המסלולים ואת זמינות נתוני הבידינג.
      </Alert>}
      {Object.keys(results)
        .sort()
        .map((faculty, facultyIndex) => (
          <div key={facultyIndex} style={{ marginTop: 10, whiteSpace: "pre" }}>
            <h3>מסלול: {faculty}</h3>
            {Object.keys(results[faculty])
              .map((course) => `${course}: ${results[faculty][course]} נקודות`)
              .join("\n")}
          </div>
        ))}
    </>
  )
}

export default AutoBidModal
