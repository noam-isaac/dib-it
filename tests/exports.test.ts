import { describe, expect, test } from "bun:test"
import JSZip from "jszip"
import { createCalendar } from "../src/serialize"
import { getRegistrationRows, registrationDefaults } from "../src/registration"
import { createRegistrationDocument } from "../src/registrationDocument"
import { getGoogleConfig } from "../src/googleConfig"
import { isScheduleBackup } from "../src/scheduleBackup"

const courses = [
  { id: "01234567", groups: ["01", "02", "01", "stale"] },
  { id: "unselected" },
]
const info = {
  "01234567": {
    name: "מבוא ל-AI & לוגיקה",
    groups: [
      { group: "01", lessons: [{ day: "א", time: "09:30-11:15" }] },
      { group: "02" },
    ],
  },
  unselected: { name: "לא נבחר", groups: [{ group: "01" }] },
}

describe("Google and Apple Calendar", () => {
  test("Jerusalem wall time survives DST, includes minutes and inclusive semester boundaries", () => {
    // Semester starts Wednesday; first Sunday is March 22, not three days later.
    const result = createCalendar("2026b", courses, info, {
      startDate: "2026-03-18",
      endDate: "2026-03-29",
    })
    expect(result.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(result).toContain("DTSTART:20260322T073000Z")
    expect(result).toContain("DTEND:20260322T091500Z")
    expect(result).toContain("DTSTART:20260329T063000Z")
    expect(result).toContain("DTEND:20260329T081500Z")
    expect(result).not.toContain("TZID:")
    expect(result).not.toContain("20260405")
  })
  test("missing dates reject promptly; malformed lessons are skipped", () => {
    expect(() => createCalendar("2026b", courses, info)).toThrow(
      "תאריכי הסמסטר",
    )
    const invalid = {
      "01234567": {
        groups: [
          {
            group: "01",
            lessons: [
              {},
              { day: "א", time: "25:00-26:00" },
              { day: "א", time: "10:00-09:00" },
            ],
          },
        ],
      },
    }
    expect(() =>
      createCalendar("2026b", courses, invalid, {
        startDate: "2026-03-18",
        endDate: "2026-03-29",
      }),
    ).toThrow("אין שיעורים")
  })
  test("exams are all-day dates and duplicated selections export once", () => {
    const result = createCalendar(
      "2026b",
      [...courses, ...courses],
      {
        "01234567": {
          groups: [{ group: "01" }],
          exams: [{ date: "27/03/2026", moed: "א" }],
        },
      },
      { startDate: "2026-03-18", endDate: "2026-03-29" },
    )
    expect(result.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(result).toContain("DTSTART;VALUE=DATE:20260327")
  })
})

describe("registration Word export", () => {
  test("includes only distinct selected valid groups, preserving zeroes", () => {
    expect(
      getRegistrationRows(
        [...courses, ...courses, { id: "missing", groups: ["01"] }],
        info,
      ),
    ).toEqual([
      { courseId: "01234567", group: "01", name: "מבוא ל-AI & לוגיקה" },
      { courseId: "01234567", group: "02", name: "מבוא ל-AI & לוגיקה" },
    ])
  })
  test("current academic year and semester replace stale template values", () => {
    expect(registrationDefaults("2027b")).toMatchObject({
      academicYear: "2027",
      semesterCode: "2",
      department: "1821",
    })
  })
  test("genuine DOCX has Hebrew typography, RTL tables, section and paragraphs, and escaped text", async () => {
    const file = await createRegistrationDocument(
      {
        ...registrationDefaults("2027a"),
        studentName: 'בדיקה <שם> & "טקסט"',
        studentId: "012345678",
      },
      getRegistrationRows(courses, info),
    )
    expect(file.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    expect(zip.file("[Content_Types].xml")).not.toBeNull()
    const xml = await zip.file("word/document.xml")!.async("string")
    expect(xml).toContain("01234567")
    expect(xml).toContain("012345678")
    expect(xml).toContain("&lt;")
    expect(xml).not.toContain("לא נבחר")
    expect(xml.match(/<w:bidiVisual\b/g)).toHaveLength(2)
    expect(xml).toMatch(/<w:sectPr>[\s\S]*<w:bidi\/>[\s\S]*<\/w:sectPr>/)
    expect(xml).not.toContain('w:jc w:val="right"')
    for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      if (/[\u0590-\u05ff]/.test(p)) expect(p).toContain("<w:bidi/>")
    }
    expect(xml).toContain('w:cs="Arial"')
    expect(xml).toContain("<w:szCs")
    expect(xml).toContain("<w:bCs")
    expect(xml).toContain("<w:tblHeader")
  })
  test("empty schedules do not create misleading forms", async () => {
    expect(
      createRegistrationDocument(registrationDefaults("2027a"), []),
    ).rejects.toThrow("יש לבחור")
  })
})

describe("Google configuration and backup compatibility", () => {
  const legacy = {
    apiKey: "key",
    authDomain: "example.firebaseapp.com",
    projectId: "example",
    appId: "app",
  }
  test("no configuration and partial configuration retain local mode", () => {
    expect(getGoogleConfig({})).toBeUndefined()
    expect(
      getGoogleConfig({
        VITE_ENABLE_GOOGLE_SYNC: "true",
        VITE_FIREBASE_API_KEY: "key",
      }),
    ).toBeUndefined()
  })
  test("legacy config works; environment overrides it; explicit false disables it", () => {
    expect(getGoogleConfig({}, legacy)).toEqual(legacy)
    expect(
      getGoogleConfig({ VITE_FIREBASE_PROJECT_ID: "custom" }, legacy)
        ?.projectId,
    ).toBe("custom")
    expect(
      getGoogleConfig({ VITE_ENABLE_GOOGLE_SYNC: "false" }, legacy),
    ).toBeUndefined()
  })
  test("old schedule backups restore, invalid course/group shapes do not", () => {
    expect(
      isScheduleBackup({
        courses: { "2027a": courses },
        semester: "2027a",
        theme: "apple",
      }),
    ).toBe(true)
    expect(isScheduleBackup({ courses: [] })).toBe(false)
    expect(
      isScheduleBackup({ courses: { "2027a": [{ id: "a", groups: [1] }] } }),
    ).toBe(false)
    expect(isScheduleBackup(null)).toBe(false)
  })
})
