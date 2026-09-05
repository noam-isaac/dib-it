import { Button, Group } from "@mantine/core"
import { useState } from "react"
import PersonalExams from "./PersonalExams"
import ExamSearch from "./ExamSearch"

const Exams = () => {
  const [searchDate, setSearchDate] = useState<string | null>(null)
  return (
    <>
      <Group justify="flex-end" className="dont-print">
        <Button
          variant="subtle"
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
