import {
  Badge,
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
import { getRegistrationDepartments, getRegistrationRows, registrationDefaults, registrationRowFitsForm } from "../registration"
import { downloadBlob, formatSemesterInHebrew } from "../utilities"

const RegistrationModal = ({
  planName,
  semester,
  courses,
  info,
}: {
  planName: string
  semester: string
  courses: DibItCourse[]
  info: SemesterCourses
}) => {
  const [details, setDetails] = useState(() => registrationDefaults(semester))
  const [busy, setBusy] = useState(false)
  const rows = getRegistrationRows(courses, info)
  // Groups the original form has no boxes for are shown as such instead of failing the download.
  const formRows = rows.filter(registrationRowFitsForm)
  const skippedRows = rows.filter((row) => !registrationRowFitsForm(row))
  const departments = getRegistrationDepartments(formRows, info)
  const multipleForms = Object.keys(departments).length > 1 || formRows.length > 14
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
          const { filename, blob, notes } = await createRegistrationDownload(details, rows, info)
          downloadBlob(filename, blob)
          notifications.show({
            title: "הטופס מוכן",
            message: [
              multipleForms
                ? "הורד ZIP עם מספר טפסי Word מקוריים. כל טופס מכיל עד 14 קבוצות."
                : "הטופס המקורי מולא והורד כקובץ DOC. בדקו את הפרטים לפני ההגשה.",
              ...notes,
            ].join(" "),
            style: { direction: "rtl" },
            color: notes.length ? "yellow" : "green",
            autoClose: notes.length ? false : undefined,
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
        <Text fw={600} style={{ overflowWrap: "anywhere" }}>מערכת שעות: {planName}</Text>
        <Text size="sm">
          מילוי טופס הרישום המקורי לתכנית הבין-תחומית, תשפ״ז.{" "}
          {formatSemesterInHebrew(semester)} · {formRows.length} קבוצות לימוד.
        </Text>
        <Text size="xs" c="dimmed">
          בדקו ששנת הטופס מתאימה לרישום שלכם.
          {multipleForms && " ייווצר ZIP עם טופס לכל חוג רושם, עד 14 קבוצות בטופס."}
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
          הפרטים האישיים אינם נשמרים באתר.
        </Text>
        {formRows.length > 0 && (
          <>
            <Text size="sm">
              חוגים רושמים: {Object.values(departments).map(({ code, name }) =>
                name ? `${name} (${code})` : code,
              ).join(" · ")}
            </Text>
            <Text size="xs" c="dimmed">
              אפשר להשלים פרטים ולתקן ב-Word לאחר ההורדה.
            </Text>
          </>
        )}
        {skippedRows.length > 0 && (
          <Text size="xs" c="yellow" role="alert">
            {skippedRows.length} קבוצות מסומנות ״לא בטופס״: מספר הקורס או הקבוצה אינם מתאימים
            למשבצות הטופס המקורי. הטופס ייווצר בלעדיהן, ואפשר להוסיף אותן ידנית ב-Word.
          </Text>
        )}
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
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <span>{row.name || "—"}</span>
                        {!registrationRowFitsForm(row) && (
                          <Badge size="xs" color="yellow" variant="light">לא בטופס</Badge>
                        )}
                      </Group>
                    </Table.Td>
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
          disabled={!formRows.length}
          leftSection={<i className="fa-solid fa-file-word" aria-hidden="true" />}
        >
          {multipleForms ? "הורדת טפסי Word (ZIP)" : "הורדת הטופס המקורי (DOC)"}
        </Button>
      </Stack>
    </form>
  )
}
export default RegistrationModal
