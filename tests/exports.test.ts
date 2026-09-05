import { describe, expect, test } from "bun:test"
import JSZip from "jszip"
import { createCalendar } from "../src/serialize"
import { getRegistrationRows, registrationDefaults } from "../src/registration"
import { createRegistrationDownload, fillRegistrationTemplate } from "../src/registrationDocument"
import manifest from "../src/assets/registration-template.json"
import { readFile } from "node:fs/promises"

const template = async () => {
  const data = await readFile(new URL("../src/assets/registration-template.doc", import.meta.url))
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}
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
  test("the retained source is exactly the user-supplied attachment", async () => {
    const source = await readFile(new URL("../templates/registration-original.doc", import.meta.url))
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", source)))
      .map(byte => byte.toString(16).padStart(2,"0")).join("")
    expect(hash).toBe("a7a94a59512fb9166a1947d743f1f41d7f41b63d63b231b8e3167c1a80e405fc")
    expect(hash).toBe(manifest.sourceSha256)
  })
  test("fills a real binary DOC and changes only allocated text bytes", async () => {
    const original = await template()
    const before = new Uint8Array(original.slice(0))
    const file = await fillRegistrationTemplate(original, {
      ...registrationDefaults("2027a"), studentName: 'בדיקה <שם> & "טקסט"', studentId: "012345678",
    }, getRegistrationRows(courses, info))
    expect(file.type).toBe("application/msword")
    const result = new Uint8Array(await file.arrayBuffer())
    expect(Array.from(result.slice(0, 8))).toEqual([208,207,17,224,161,177,26,225])
    expect(result.length).toBe(before.length)
    const allowed = new Set(manifest.slots.flatMap(slot => slot.offsets))
    const changed = Array.from(result.keys()).filter(i => result[i] !== before[i])
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.every(i => allowed.has(i))).toBe(true)
    const value = (key: string) => {
      const slot = manifest.slots.find(s => s.key === key)!
      return String.fromCharCode(...Array.from({ length: slot.length }, (_, i) =>
        result[slot.offsets[2*i]] | result[slot.offsets[2*i+1]] << 8)).replace(/[\u200b\u202a\u202c]/g, "")
    }
    expect(value("studentName")).toBe('בדיקה <שם> & "טקסט"')
    expect(Array.from({length:9}, (_, i) => value(`studentId.${i}`)).join("")).toBe("012345678")
    expect(value("rows.0.name")).toBe("מבוא ל-AI & לוגיקה")
    expect(value("rows.1.group.1")).toBe("2")
    expect(value("rows.2.name")).toBe("")
    expect(value("rows.13.courseId.0")).toBe("")
    expect(new Uint8Array(original)).toEqual(before)
  })
  test("15 groups produce two intact DOC forms instead of adding rows or dropping data", async () => {
    const rows = Array.from({length:15}, (_, i) => ({courseId:"01234567",group:String(i+1).padStart(2,"0"),name:`קורס ${i+1}`}))
    const download = await createRegistrationDownload(registrationDefaults("2027a"), rows, await template())
    expect(download.filename.endsWith(".zip")).toBe(true)
    const zip = await JSZip.loadAsync(await download.blob.arrayBuffer())
    expect(Object.keys(zip.files)).toHaveLength(2)
    for (const file of Object.values(zip.files)) {
      expect(file.name.endsWith(".doc")).toBe(true)
      expect((await file.async("uint8array")).length).toBe(manifest.byteLength)
    }
    const second = await zip.file("dibit-registration-2027-1-2.doc")!.async("uint8array")
    const slot = manifest.slots.find(s => s.key === "rows.0.group.1")!
    expect(second[slot.offsets[0]]).toBe("5".charCodeAt(0))
    const single = await createRegistrationDownload(registrationDefaults("2027a"), rows.slice(0,14), await template())
    expect(single.filename.endsWith(".doc")).toBe(true)
  })
  test("refuses corrupt templates, structural control characters, oversized fields and invalid digit boxes", async () => {
    const data = await template(), details = registrationDefaults("2027a"), rows = getRegistrationRows(courses, info)
    const corrupt = data.slice(0); new Uint8Array(corrupt)[100] ^= 1
    await expect(fillRegistrationTemplate(corrupt, details, rows)).rejects.toThrow("תבנית")
    await expect(fillRegistrationTemplate(data, {...details,studentName:"a\u0007b"}, rows)).rejects.toThrow("בקרה")
    await expect(fillRegistrationTemplate(data, {...details,studentName:"א".repeat(101)}, rows)).rejects.toThrow("ארוך")
    await expect(fillRegistrationTemplate(data, {...details,studentId:"123"}, rows)).rejects.toThrow("9")
    await expect(fillRegistrationTemplate(data, details, [{...rows[0],group:"001"}])).rejects.toThrow("משבצות")
    await expect(fillRegistrationTemplate(data, details, [])).rejects.toThrow("יש לבחור")
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
