import { expect, test } from "bun:test"
import { annualGroupIds, syncAnnualCourses } from "../src/annualCourses"
import catalogs from "./fixtures/annual-catalogs-2026.json"

test("identical semester offerings are not annual: official phantom lab counterexample", () => {
  const id = "01911111"
  const courses = { "2026a": [{ id, groups: ["01"] }] }
  expect(catalogs["2026a"][id].exams).toEqual(catalogs["2026b"][id].exams)
  expect(catalogs["2026a"][id].groups[0].lecturer).toEqual(catalogs["2026b"][id].groups[0].lecturer)
  expect(annualGroupIds({}, "2026a", id)).toEqual([])
  expect(syncAnnualCourses({}, { semester: "2026a", courses }, catalogs)).toEqual(courses)
})

test("official annual status survives changed lecturers and exams; unknown years never inherit it", () => {
  const id = "10313103"
  const courses = { "2026a": [{ id, groups: ["01"] }] }
  const changed = { ...catalogs, "2026b": { [id]: {
    ...catalogs["2026b"][id], exams: [{ date: "01/07/2026" }],
    groups: [{ ...catalogs["2026b"][id].groups[0], lecturer: "Changed lecturer" }],
  } } }
  expect(syncAnnualCourses({}, { semester: "2026a", courses }, changed)!["2026b"]).toEqual(courses["2026a"])
  expect(annualGroupIds({}, "2099a", id)).toEqual([])
  expect(annualGroupIds({}, "2026a", id)).toEqual(["01"])
})

// Public JSON excerpts: courses-2026a.json and courses-2026b.json, retrieved 2026-09-08.
test("real annual project syncs in both directions despite different semester rooms", () => {
  for (const semester of ["2026a", "2026b"]) {
    const other = semester === "2026a" ? "2026b" : "2026a"
    const course = { id: "10313103", groups: ["01"] }
    const result = syncAnnualCourses({}, { semester, courses: { [semester]: [course] } }, catalogs)!
    expect(result[other]).toEqual([course])
    expect(catalogs["2026a"][course.id].groups[0].lessons[0].room).not.toBe(catalogs["2026b"][course.id].groups[0].lessons[0].room)
  }
})

test("a real semester-only calculus course stays in its own semester", () => {
  const courses = { "2026a": [{ id: "03661100", groups: ["01"] }] }
  expect(syncAnnualCourses({}, { semester: "2026a", courses }, catalogs)).toEqual(courses)
})

const group = (group: string, lecturer = "Lecturer") => ({ group, lecturer, lessons: [] })
const mixed = {
  "2026a": { "10313103": { groups: [group("01"), group("02")] } },
  "2026b": { "10313103": { groups: [group("01"), group("03")] } },
}
test("syncs shared groups, preserves semester-only selections, and removes shared selections", () => {
  const before = { "2026a": [{ id: "10313103", groups: ["02"] }], "2026b": [{ id: "10313103", groups: ["03"] }] }
  const selected = { ...before, "2026a": [{ id: "10313103", groups: ["01", "02"] }] }
  const added = syncAnnualCourses(before, { semester: "2026a", courses: selected }, mixed)!
  expect(added["2026b"][0].groups).toEqual(["03", "01"])
  const removed = syncAnnualCourses(added, { semester: "2026a", courses: { ...added, "2026a": [] } }, mixed)!
  expect(removed["2026b"][0].groups).toEqual(["03"])
  expect(before["2026b"][0].groups).toEqual(["03"])
})

test("does not synchronize a verified group missing from the other catalog", () => {
  const courses = { "2026a": [{ id: "10313103", groups: ["01"] }] }
  for (const target of [undefined, { groups: [group("02")] }]) {
    expect(syncAnnualCourses({}, { semester: "2026a", courses }, {
      "2026a": mixed["2026a"], "2026b": { "10313103": target },
    })).toEqual(courses)
  }
})

test("late catalog reconciliation preserves selections already saved in either semester", () => {
  const courses = { "2026a": [{ id: "10313103", groups: [] }], "2026b": [{ id: "10313103", groups: ["01", "03"] }] }
  const result = syncAnnualCourses(courses, { semester: "2026a", courses }, mixed)!
  expect(result["2026b"][0].groups).toEqual(["01", "03"])
  const reconciled = syncAnnualCourses(result, { semester: "2026b", courses: result }, mixed)!
  expect(reconciled["2026a"][0].groups).toEqual([])
})
