import { expect, test } from "bun:test"
import { importSemesterCourses, selectedGroups, selectedCatalogConflicts } from "../src/catalog"
import { sumHours } from "../src/utilities"
import { createCalendar } from "../src/serialize"
import { getRegistrationRows } from "../src/registration"
import french from "./fixtures/french-catalogs-2027.json"

const lesson = { day: "א", time: "08:00-10:00", building: "Webb", room: "104", type: "שיעור" }
const record = { group: "01", lecturer: "A", lessons: [lesson] }
const selected = [{ id: "21721600", groups: ["01", "01"] }]
const dates = { startDate: "2026-10-18", endDate: "2026-10-24" }

// Freeze every nested source object so accidental mutation fails immediately.
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

test.each(Object.entries(french))("French %s: four hours, unique groups and original data", (semester, source) => {
  const catalog = importSemesterCourses(semester, freeze(source))
  expect(catalog["21721600"]!.groups.size).toBe(2)
  expect(catalog["21721600"]!.semester).toBe(semester)
  expect(selectedGroups(selected[0], catalog["21721600"])).toHaveLength(1)
  expect(sumHours(catalog, { semester, courses: { [semester]: selected } })).toBe(4)
  expect(createCalendar(semester, selected, catalog, dates).match(/BEGIN:VEVENT/g)).toHaveLength(2)
  expect(getRegistrationRows(selected, catalog)).toHaveLength(1)
  const group = catalog["21721600"]!.groups.get("01")!
  expect(group.status).toBe("ready")
  if (group.status === "ready") expect(group.data).toBe(source["21721600"].groups[0])
})

test.each(["lecturer", "day", "time", "building", "room", "type"])("different %s is a conflict, never a merged record", field => {
  const different = field === "lecturer" ? { ...record, lecturer: "B" }
    : { ...record, lessons: [{ ...lesson, [field]: "different" }] }
  const source = freeze({ "21721600": { groups: [record, different] } })
  const catalog = importSemesterCourses("2027a", source)
  expect(catalog["21721600"]!.groups.get("01")).toEqual({ group: "01", status: "conflict", records: source["21721600"].groups })
  expect(selectedCatalogConflicts(selected, catalog)).toEqual(["21721600/01"])
  expect(sumHours(catalog, { semester: "2027a", courses: { "2027a": selected } })).toBe(0)
  expect(() => createCalendar("2027a", selected, catalog, dates)).toThrow("סותרים")
  expect(() => getRegistrationRows(selected, catalog)).toThrow("סותרים")
  expect(importSemesterCourses("2027a", { "21721600": { groups: [different, record] } })["21721600"]!.groups.get("01")!.status).toBe("conflict")
})

test("order of lessons and object properties does not create a conflict; multiplicity does", () => {
  const second = { ...lesson, day: "ג" }
  const equivalent = { group: "01", lecturer: "A", lessons: [second, { type: lesson.type, room: lesson.room, building: lesson.building, time: lesson.time, day: lesson.day }] }
  const first = { ...record, lessons: [lesson, second] }
  const catalog = importSemesterCourses("2027a", freeze({ one: { groups: [first, equivalent] } }))
  expect(catalog.one!.groups.get("01")).toEqual({ group: "01", status: "ready", data: first })
  const repeated = importSemesterCourses("2027a", { one: { groups: [{ ...record, lessons: [lesson, lesson] }, first] } })
  expect(repeated.one!.groups.get("01")!.status).toBe("conflict")
})

test("unnamed groups remain visible as import issues without inventing identities", () => {
  const unnamed = [{ lessons: [lesson] }, { group: "", lessons: [lesson] }]
  const catalog = importSemesterCourses("2027a", freeze({ one: { groups: [record, ...unnamed] }, empty: {} }))
  expect([...catalog.one!.groups.keys()]).toEqual(["01"])
  expect(catalog.one!.unidentifiedGroups).toEqual(unnamed)
  expect(catalog.empty!.groups.size).toBe(0)
})

test("year and semester isolate identical course/group IDs; mismatched exports reject", () => {
  const source = { "21721600": { groups: [record] } }
  const a = importSemesterCourses("2026a", freeze(source))
  const b = importSemesterCourses("2026b", { "21721600": { groups: [{ ...record, lessons: [{ ...lesson, time: "10:00-13:00" }] }] } })
  const next = importSemesterCourses("2027a", source)
  expect(sumHours(a, { semester: "2026a", courses: { "2026a": selected } })).toBe(2)
  expect(sumHours(b, { semester: "2026b", courses: { "2026b": selected } })).toBe(3)
  expect(sumHours(next, { semester: "2027a", courses: { "2027a": selected } })).toBe(2)
  expect(sumHours(a, { semester: "2027a", courses: { "2027a": selected } })).toBe(0)
  expect(() => createCalendar("2027a", selected, a, dates)).toThrow("לסמסטר")
})

test.each([null, [], { one: { groups: {} } }, { one: { groups: [{ lessons: [null] }] } }, { one: { groups: [{ lecturer: 5 }] } }].map(source => [source]))("malformed catalogs reject at import", source => {
  expect(() => importSemesterCourses("2027a", source)).toThrow("תקינים")
})

test("nullable lecturers in actual upstream records and empty catalogs are valid", () => {
  expect(importSemesterCourses("2023a", { one: { groups: [{ group: "01", lecturer: null }] } }).one!.groups.get("01")!.status).toBe("ready")
  expect(importSemesterCourses("2023a", {})).toEqual({})
  expect(() => importSemesterCourses("2023c", {})).toThrow("תקינים")
})
