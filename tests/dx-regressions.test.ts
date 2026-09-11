import { expect, test } from "bun:test"
import { getPastAndPresentCourses, sumHours } from "../src/utilities"

test("prerequisites exclude future courses when the selected semester has no saved entry", () => {
  const [past, present] = getPastAndPresentCourses({ courses: {
    "2025a": [{ id: "past" }], "2027a": [{ id: "future" }],
  } }, "2026b")
  expect([...past]).toEqual(["past"])
  expect([...present]).toEqual(["past"])
})

test("weekly hours include minutes, ignore invalid times and count selected groups once", () => {
  const times = ["09:30-11:00", "12:00-12:45", "", "unknown", "25:00-26:00", "12:70-13:00", "15:00-14:00"]
  expect(sumHours({ one: { groups: [
    { group: "01", lessons: times.map(time => ({ time, day: "א" })).concat([{ time: "09:00-10:00", day: "" }, { time: "09:00-10:00", day: "ש" }]) },
    { group: "02", lessons: [{ time: "08:00-10:00" }] },
  ] } }, { semester: "2026a", courses: { "2026a": [{ id: "one", groups: ["01", "01", "stale"] }] } })).toBe(2.25)
})
