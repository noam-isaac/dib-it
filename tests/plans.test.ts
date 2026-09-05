import { describe, expect, test } from "bun:test"
import { activePlanView, addPlan, deletePlan, normalizePlans, renamePlan, updateActivePlan } from "../src/plans"
import { isScheduleBackup } from "../src/scheduleBackup"

const legacy = {
  courses: {
    "2025a": [{ id: "01234567", groups: ["01", "02"], color: "#ff0000", studyPlanCategory: "חובה" }],
    "2025b": [{ id: "12345678", groups: ["03"] }],
  },
  semester: "2025a", tab: "exams", theme: "apple",
  school: "פקולטה", studyPlan: "תואר", degreeStartYear: "2025",
  practicedExams: { "01234567": ["2024a"] },
  customCourses: { "custom.json": { "11111111": { name: "קורס אישי" } } },
}

describe("saved schedule plans", () => {
  test("legacy data preserves all semesters, selections and shared settings without mutating the source", () => {
    const before = structuredClone(legacy)
    const workspace = normalizePlans(legacy)
    expect(activePlanView(workspace)).toEqual({ ...legacy, activePlanId: "default" })
    expect(normalizePlans(workspace)).toEqual(workspace)
    expect(legacy).toEqual(before)
    expect(isScheduleBackup(workspace)).toBe(true)
  })

  test("a blank plan keeps degree settings, and switching restores the original schedule", () => {
    const first = normalizePlans(legacy)
    const workspace = addPlan(first, "  חלופה  ")
    expect(workspace.plans).toHaveLength(2)
    expect(workspace.plans[1].name).toBe("חלופה")
    expect(activePlanView(workspace)).toMatchObject({ courses: {}, school: legacy.school, semester: legacy.semester })
    const edited = updateActivePlan(workspace, {
      ...activePlanView(workspace), courses: { "2025a": [{ id: "99999999", groups: ["09"] }] },
    })
    expect(activePlanView({ ...edited, activePlanId: first.activePlanId }).courses).toEqual(legacy.courses)
    expect(activePlanView(edited).courses!["2025a"][0].id).toBe("99999999")
    expect(addPlan(first, " ")).toBe(first)
  })

  test("duplicates deeply isolate courses, groups, colors and categories across semesters", () => {
    const workspace = addPlan(normalizePlans(structuredClone(legacy)), "עותק", true)
    const view = activePlanView(workspace)
    view.courses!["2025a"][0].groups!.push("09")
    view.courses!["2025a"][0].color = "blue"
    view.courses!["2025a"][0].studyPlanCategory = "בחירה"
    view.courses!["2025b"] = []
    const saved = updateActivePlan(workspace, view)
    expect(saved.plans[0].courses).toEqual(legacy.courses)
    expect(saved.plans[1].courses).toEqual(view.courses)
  })

  test("rename and delete preserve other plans and cannot remove the final plan", () => {
    let workspace = addPlan(normalizePlans(legacy), "שנייה")
    const id = workspace.activePlanId
    workspace = renamePlan(workspace, id, "  חדש  ")
    expect(workspace.plans[1].name).toBe("חדש")
    expect(renamePlan(workspace, id, " ")).toBe(workspace)
    const deletedInactive = deletePlan(workspace, "default")
    expect(deletedInactive.activePlanId).toBe(id)
    workspace = deletePlan(workspace, id)
    expect(workspace.activePlanId).toBe("default")
    expect(activePlanView(workspace).courses).toEqual(legacy.courses)
    expect(deletePlan(workspace, "default")).toBe(workspace)
  })

  test("stale callbacks cannot overwrite another active plan", () => {
    const first = normalizePlans(legacy)
    const stale = activePlanView(first)
    const next = addPlan(first, "חלופה")
    expect(updateActivePlan(next, { ...stale, courses: {} })).toBe(next)
  })

  test("JSON and cloud payload round trips retain every plan and the active selection", () => {
    const workspace = addPlan(normalizePlans(legacy), "חלופה", true)
    const restored = JSON.parse(JSON.stringify(workspace))
    expect(isScheduleBackup(restored)).toBe(true)
    expect(normalizePlans(restored)).toEqual(workspace)
    expect(activePlanView(restored).courses).toEqual(legacy.courses)
    expect(isScheduleBackup(legacy)).toBe(true)
  })

  test("malformed multi-plan backups are rejected before replacing local data", () => {
    const workspace = normalizePlans(legacy)
    for (const invalid of [
      { ...workspace, plans: [] },
      { ...workspace, plans: {} },
      { ...workspace, activePlanId: "missing" },
      { ...workspace, plans: [workspace.plans[0], workspace.plans[0]] },
      { ...workspace, plans: [{ ...workspace.plans[0], name: " " }] },
      { ...workspace, plans: [{ ...workspace.plans[0], courses: { "2025a": [{ id: "1", groups: [1] }] } }] },
      { ...workspace, plans: [{ ...workspace.plans[0], studyPlan: [] }] },
    ]) expect(isScheduleBackup(invalid)).toBe(false)
  })
})
