import { expect, test } from "bun:test"
import { getRegistrationRows, registrationCourseName } from "../src/registration"
import catalog from "./fixtures/registration-catalog-2025b.json"
import examples from "./fixtures/registration-examples.json"

// Public 2025b catalog, retrieved 2026-09-05; only example course/group data retained.
// https://arazim-project.com/data/courses-2025b.json
test("five supplied forms match the actual catalog, including lesson types", () => {
  for (const [department, expected] of Object.entries(examples)) {
    if (department === "cs") continue
    const rows = getRegistrationRows(expected.map(row => ({
      id: row.courseId, groups: [row.group],
    })), catalog)
    expect(rows.map(row => ({
      courseId: row.courseId, group: row.group, name: registrationCourseName(row),
    }))).toEqual(expected.map(({ courseId, group, name }) => ({ courseId, group, name })))
  }
})

test("the catalog takes precedence over the inconsistent computer-science example", () => {
  const rows = getRegistrationRows([{ id: "03682158", groups: ["09", "17"] }], catalog)
  expect(rows).toHaveLength(1)
  expect(rows[0].group).toBe("09")
  expect(registrationCourseName(rows[0])).toBe("מבני נתונים - (שיעור)")
})
