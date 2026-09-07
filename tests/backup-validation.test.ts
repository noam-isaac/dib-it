import { expect, test } from "bun:test"
import { isScheduleBackup } from "../src/scheduleBackup"
import { normalizePlans } from "../src/plans"

const schedule = {
  semester: "2026a", tab: "practice",
  courses: { "2026a": [{ id: "03682158", groups: ["01"] }] },
}

test("unrelated JSON and malformed shared settings cannot replace a workspace", () => {
  for (const invalid of [
    {}, { unrelated: "not a backup" },
    { ...schedule, practicedExams: { "03682158": {} } },
    { ...schedule, practicedExams: { "03682158": [1] } },
    { ...schedule, openedPracticeCourses: {} },
    { ...schedule, openedPracticeCourses: [null] },
    { ...schedule, customCourses: [] },
    { ...schedule, theme: "missing-theme" },
    { ...schedule, semester: "not-a-semester" },
  ]) expect(isScheduleBackup(invalid)).toBe(false)
  expect(isScheduleBackup(schedule)).toBe(true)
  expect(isScheduleBackup({ courses: {} })).toBe(true)
  expect(isScheduleBackup(normalizePlans({}))).toBe(true)
})

test("nested custom catalogs are checked without dropping valid optional fields", () => {
  const backup = (course: unknown) => ({
    ...schedule,
    customCourses: { "custom.json": { "03682158": course } },
    practicedExams: { "03682158": ["2025a"] }, openedPracticeCourses: ["0"],
  })
  const course = {
    name: "בדיקה", faculty: "פקולטה/חוג",
    groups: [{ group: "01", lessons: [{ time: "10:00-11:00", day: "א", type: "שיעור" }] }],
    exams: [{ date: "23/02/2026", moed: "א" }],
    exam_links: ["https://example.com/exam.pdf"],
    prerequisites: { kind: "all", courses: ["01234567", { kind: "any", courses: [] }], parallel: null },
  }
  for (const valid of [course, {}, { groups: [{ group: "01" }] }, { prerequisites: null }]) {
    expect(isScheduleBackup(backup(valid))).toBe(true)
    expect(isScheduleBackup({ ...normalizePlans(schedule), customCourses: backup(valid).customCourses })).toBe(true)
  }
  for (const invalid of [
    null, { name: {} }, { groups: {} }, { groups: [null] },
    { groups: [{ lessons: {} }] }, { groups: [{ lessons: [null] }] },
    { groups: [{ lessons: [{ time: 10 }] }] }, { exams: [{} , null] },
    { exams: [{ date: 123 }] }, { exam_links: [1] },
    { prerequisites: { courses: {} } }, { prerequisites: { parallel: "bad" } },
    { prerequisites: { courses: [{ courses: [null] }] } },
  ]) expect(isScheduleBackup(backup(invalid))).toBe(false)
})
