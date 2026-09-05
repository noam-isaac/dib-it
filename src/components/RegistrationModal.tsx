import {
  Button,
  Group,
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
  const [busy, setBusy] = useState(false)
  const rows = getRegistrationRows(courses, info)
  const departments = getRegistrationDepartments(rows, info)
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
          const { filename, blob } = await createRegistrationDownload(details, rows, info)
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
        <Text size="sm">
          חוגים רושמים: {Object.values(departments).map(({ code, name }) =>
            name ? `${name} (${code})` : code,
          ).join(" · ")}
        </Text>
        <Text size="xs" c="dimmed">
          פרטי הקורסים והחוגים מתמלאים אוטומטית. פרטים חסרים ותיקונים אפשר להשלים ב-Word לאחר ההורדה.
        </Text>
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
                    <Table.Td>{row.name || "—"}</Table.Td>
                    <Table.Td dir="ltr">{row.courseId}</Table.Td>
                    <Table.Td dir="ltr">{row.group}</Table.Td>
                    <Table.Td>{row.lessonType || "—"}</Table.Td>
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
