import {
  Button,
  Collapse,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { useState } from "react"
import type { DibItCourse } from "../models"
import { getRegistrationDepartments, getRegistrationRows, registrationDefaults } from "../registration"
import { downloadBlob, formatSemesterInHebrew } from "../utilities"

const RegistrationModal = ({
  semester,
  courses,
  info,
}: {
  semester: string
  courses: DibItCourse[]
  info: SemesterCourses
}) => {
  const [details, setDetails] = useState(() => registrationDefaults(semester))
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [departments, setDepartments] = useState(() => getRegistrationDepartments(getRegistrationRows(courses, info)))
  const [courseNames, setCourseNames] = useState<Record<string, string>>({})
  const [lessonTypes, setLessonTypes] = useState<Record<string, string>>({})
  const baseRows = getRegistrationRows(courses, info)
  const rows = baseRows.map(row => ({
    ...row, name: courseNames[row.courseId] ?? row.name, lessonType: lessonTypes[`${row.courseId}/${row.group}`] ?? row.lessonType,
  }))
  const multipleForms = Object.keys(departments).length > 1 || rows.length > 14
  const field = (key: keyof typeof details) => ({
    value: details[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setDetails({ ...details, [key]: e.currentTarget.value }),
  })
  return (
    <form
      dir="rtl"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        try {
          const { createRegistrationDownload } =
            await import("../registrationDocument")
          const { filename, blob } = await createRegistrationDownload(details, rows, undefined, departments)
          downloadBlob(filename, blob)
          notifications.show({
            title: "הטופס מוכן",
            message: multipleForms
              ? "הורד ZIP עם מספר טפסי Word מקוריים. כל טופס מכיל עד 14 קבוצות."
              : "הטופס המקורי מולא והורד כקובץ DOC. בדקו את הפרטים לפני ההגשה.",
            color: "green",
          })
        } catch (error) {
          notifications.show({
            title: "יצירת הטופס נכשלה",
            message: error instanceof Error ? error.message : "נסו שוב.",
            color: "red",
          })
        } finally {
          setBusy(false)
        }
      }}
    >
      <Stack gap="sm">
        <Text size="sm">
          מילוי טופס הרישום המקורי לתכנית הבין-תחומית, תשפ״ז.{" "}
          {formatSemesterInHebrew(semester)} · {rows.length} קבוצות לימוד.
        </Text>
        <Text size="xs" c="dimmed">
          הכותרת, הסמלים ומשבצות הטופס המקורי נשמרים. בדקו ששנת הטופס מתאימה
          לרישום שלכם. נוצר טופס לכל חוג רושם, עד 14 קבוצות בטופס. מספר טפסים יורדו ב-ZIP.
        </Text>
        <Group grow>
          <TextInput
            required
            label="שם התלמיד/ה"
            autoComplete="name"
            maxLength={100}
            {...field("studentName")}
          />
          <TextInput
            required
            label="מספר ת״ז"
            dir="ltr"
            inputMode="numeric"
            pattern="[0-9]{9}"
            maxLength={9}
            {...field("studentId")}
          />
        </Group>
        <Text size="xs" c="dimmed">
          השלימו את הפרטים האישיים כדי שיופיעו בטופס. הפרטים אינם נשמרים באתר.
        </Text>
        <Text size="sm">בדקו את החוגים הרושמים. הקוד מוצע לפי ארבע הספרות הראשונות של הקורס.</Text>
        {Object.entries(departments).map(([prefix, department]) => (
          <Group grow key={prefix}>
            <TextInput
              required label={`קוד החוג הרושם (${prefix})`} dir="ltr"
              value={department.code} maxLength={4} inputMode="numeric" pattern="[0-9]{4}"
              onChange={event => setDepartments({ ...departments, [prefix]: { ...department, code: event.currentTarget.value } })}
            />
            <TextInput
              required label={`שם החוג הרושם (${prefix})`}
              value={department.name} maxLength={100}
              onChange={event => setDepartments({ ...departments, [prefix]: { ...department, name: event.currentTarget.value } })}
            />
          </Group>
        ))}
        <Button
          variant="subtle"
          size="xs"
          onClick={() => setAdvanced(!advanced)}
          aria-expanded={advanced}
        >
          פרטי רישום נוספים
        </Button>
        <Collapse in={advanced}>
          <Stack gap="xs">
            <Group grow>
              <TextInput
                label="חוג לימודים"
                {...field("department")}
                maxLength={4}
                inputMode="numeric"
                pattern="[0-9]{4}"
              />
            </Group>
            <Group grow>
              <TextInput label="תואר" {...field("degree")} maxLength={24} />
              <TextInput label="מסגרת" {...field("framework")} maxLength={3} inputMode="numeric" pattern="[0-9]{3}" />
              <Select
                label="סמסטר בטופס"
                value={details.semesterCode}
                allowDeselect={false}
                onChange={(value) =>
                  value && setDetails({ ...details, semesterCode: value })
                }
                data={[
                  { value: "1", label: "א׳" },
                  { value: "2", label: "ב׳" },
                  { value: "0", label: "שנתי" },
                  { value: "3", label: "קיץ" },
                ]}
              />
            </Group>
          </Stack>
        </Collapse>
        {rows.length ? (
          <Table.ScrollContainer minWidth={280} maxHeight={240}>
            <Table striped fz="sm" horizontalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>קורס</Table.Th>
                  <Table.Th>מספר</Table.Th>
                  <Table.Th>קבוצה</Table.Th>
                  <Table.Th>סוג השיעור</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={`${row.courseId}/${row.group}`}>
                    <Table.Td>{info[row.courseId]?.name?.trim() ? row.name : (
                      <TextInput required aria-label={`שם הקורס ${row.courseId}`} placeholder="השלימו שם קורס"
                        value={row.name} onChange={event => setCourseNames({ ...courseNames, [row.courseId]: event.currentTarget.value })} />
                    )}</Table.Td>
                    <Table.Td dir="ltr">{row.courseId}</Table.Td>
                    <Table.Td dir="ltr">{row.group}</Table.Td>
                    <Table.Td>
                      <TextInput
                        required aria-label={`סוג השיעור ${row.courseId}/${row.group}`}
                        placeholder="השלימו סוג שיעור" value={row.lessonType}
                        onChange={event => setLessonTypes({ ...lessonTypes, [`${row.courseId}/${row.group}`]: event.currentTarget.value })}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text>בחרו קבוצות לימוד בקורסים שבמערכת כדי ליצור את הטופס.</Text>
        )}
        <Button
          type="submit"
          loading={busy}
          disabled={!rows.length}
          leftSection={<i className="fa-solid fa-file-word" />}
        >
          {multipleForms ? "הורדת טפסי Word (ZIP)" : "הורדת הטופס המקורי (DOC)"}
        </Button>
      </Stack>
    </form>
  )
}
export default RegistrationModal
