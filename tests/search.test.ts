import { expect, test } from "bun:test"
import { filterSearchOptions, searchItems } from "../src/search"
import catalog from "./fixtures/study-programs-2025.json"

test("name searches handle Hebrew typos and reordered words across programs, faculties and courses", () => {
  const labels = [
    "משפטים",
    "תוכנית חד-חוגית במתמטיקה",
    "תוכנית דו-חוגית במתמטיקה ובמדעי המחשב",
    'הפקולטה למדעים מדויקים ע"ש סאקלר',
    "מבני נתונים (03682158)",
    "מָתֵמָטִיקָה",
    "Introduction to Computer Science",
  ]
  const items = labels.map(label => ({ label }))
  for (const [query, expected] of [
    ["מתמטיקה חג", labels[1]],
    ["חג מתמטיקה", labels[1]],
    ["מחשב מתמטקה", labels[2]],
    ["מדוייקים מדע", labels[3]],
    ["סאקלר ע״ש", labels[3]],
    ["נתוינם מבני", labels[4]],
    ["0368 נתונימ", labels[4]],
    ["2158", labels[4]],
    ["מבני 2158", labels[4]],
    ["מתמטיקה", labels[5]],
    ["SCIENCE computer", labels[6]],
  ]) expect(searchItems(items, query)[0]?.label).toBe(expected)
  expect(searchItems(items, "מתמטיקה חג").map(item => item.label)).not.toContain(labels[2])
  for (const query of ["03682159", "03681258", "מבני 03682159", "zzzzzz"]) {
    expect(searchItems(items, query)).toEqual([])
  }
})

test("the actual catalog distinguishes single and dual majors, including the screenshot typo", () => {
  const items = catalog.programs.map(label => ({ label }))
  const single = catalog.programs.filter(label => label.includes("חד-חוגית במתמטיקה")).sort()
  const dual = catalog.programs.filter(label => /דו[ -]חוגית/.test(label) && label.includes("מתמטיקה")).sort()
  expect(single).toHaveLength(6)
  expect(dual).toHaveLength(6)
  for (const query of ["מתמטיקה חג חוגי", "מתמטיקה חד חוגי", "חד חוגי מתמטיקה", "מתמטיקה חג"]) {
    expect(searchItems(items, query).map(item => item.label).sort()).toEqual(single)
  }
  for (const query of ["מתמטיקה דו חוגי", "דו חוגי מתמטיקה"]) {
    expect(searchItems(items, query).map(item => item.label).sort()).toEqual(dual)
  }
  const partial = searchItems(items, "מתמ").map(item => item.label)
  for (const label of [...single, ...dual]) expect(partial).toContain(label)
})

test("dropdowns retain option data, limit ranked matches and restore the full list when cleared", () => {
  const options = [
    { value: "typo", label: "מתמטיקא" },
    { value: "part", label: "מתמטיקה שימושית", disabled: true },
    { value: "exact", label: "מתמטיקה" },
    { value: "unrelated", label: "משפטים" },
  ]
  const before = structuredClone(options)
  expect(filterSearchOptions({ options, search: "מתמטיקה", limit: 2 })).toEqual([options[2], options[1]])
  expect(filterSearchOptions({ options, search: "", limit: 2 })).toEqual(options.slice(0, 2))
  expect(filterSearchOptions({ options, search: "", limit: 0 })).toEqual([])
  expect(filterSearchOptions({ options, search: "מתמטיקה", limit: 0 })).toEqual([])
  expect(searchItems([], "מתמטיקה חג")).toEqual([])
  expect(options).toEqual(before)
})
