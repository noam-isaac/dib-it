import { expect, test } from "bun:test"
import { activePlanView, normalizePlans, updateActivePlan } from "../src/plans"
import { annualGroupIds } from "../src/annualCourses"
import {
  compareSchedules,
  retainMergeChoices,
  recheckScheduleChoices,
} from "../src/scheduleMerge"
import { readSyncBase as sharedMergeBase } from "../src/scheduleSync"
import { cloudCopyKey, scheduleKey, syncDecision } from "../src/scheduleSync"

const workspace = (...ids: string[]) =>
  normalizePlans({
    semester: "2026a",
    courses: {
      "2026a": ids.map((id) => ({ id, groups: ["01"], note: "keep" })),
    },
  })
const ids = (value: ReturnType<typeof compareSchedules>) =>
  value.workspace?.plans[0]?.courses?.["2026a"]?.map((course) => course.id)

test("plan names merge independently while academic context stays together", () => {
  const base = normalizePlans({
    ...workspace("math"),
    plans: workspace("math").plans.map((plan) => ({
      ...plan,
      school: "Math",
      studyPlan: "BSc",
    })),
  })
  const local = {
    ...base,
    plans: base.plans.map((plan) => ({ ...plan, name: "Renamed" })),
  }
  const remote = {
    ...base,
    plans: base.plans.map((plan) => ({
      ...plan,
      school: "Arts",
      studyPlan: "BA",
    })),
  }
  const result = compareSchedules(base, local, remote)
  expect(result.unresolved).toHaveLength(0)
  expect(result.workspace?.plans[0]).toMatchObject({
    name: "Renamed",
    school: "Arts",
    studyPlan: "BA",
  })
  const competing = {
    ...base,
    plans: base.plans.map((plan) => ({ ...plan, studyPlan: "MSc" })),
  }
  expect(compareSchedules(base, competing, remote).unresolved).toHaveLength(1)
  expect(
    compareSchedules(base, local, {
      ...base,
      plans: base.plans.map((plan) => ({ ...plan, name: "Another name" })),
    }).unresolved,
  ).toHaveLength(1)
})

test("practice markers combine independent additions and removals within and across courses", () => {
  const base = {
    ...workspace("math"),
    practicedExams: { math: ["old", "keep"], literature: ["old"] },
    openedPracticeCourses: ["math", "literature"],
  }
  const local = {
    ...base,
    practicedExams: { math: ["keep", "local"] },
    openedPracticeCourses: ["literature", "logic"],
  }
  const remote = {
    ...base,
    practicedExams: {
      math: ["old", "keep", "remote"],
      literature: ["old", "new"],
      logic: ["new"],
    },
    openedPracticeCourses: ["math", "literature", "syntax"],
  }
  const original = JSON.stringify([base, local, remote])
  const result = compareSchedules(base, local, remote)
  expect(result.unresolved).toHaveLength(0)
  expect(result.workspace?.practicedExams).toEqual({
    math: ["keep", "local", "remote"],
    literature: ["new"],
    logic: ["new"],
  })
  expect(result.workspace?.openedPracticeCourses).toEqual([
    "literature",
    "logic",
    "syntax",
  ])
  expect(JSON.stringify([base, local, remote])).toBe(original)
  expect(compareSchedules(undefined, local, remote).workspace).toBeUndefined()
})

test("group click order is ignored by sync, review and merge without mutating either copy", () => {
  const withGroups = (groups: string[]) => ({
    ...workspace("math"),
    plans: workspace("math").plans.map((plan) => ({
      ...plan,
      courses: { "2026a": [{ id: "math", groups }] },
      pendingAnnualChanges: [
        { semester: "2026a", id: "math", groups, changedGroups: groups },
      ],
    })),
  })
  const base = withGroups(["02", "01"])
  const local = withGroups(["01", "02"])
  const remote = {
    ...base,
    plans: base.plans.map((plan) => ({
      ...plan,
      courses: {
        "2026a": [{ id: "math", groups: ["02", "01"], color: "blue" }],
      },
    })),
  }
  const before = JSON.stringify([base, local, remote])
  const oldBase = JSON.stringify({ schemaVersion: 1, plans: base.plans })
  expect(scheduleKey(local)).toBe(scheduleKey(base))
  expect(syncDecision(local, remote, oldBase)).toBe("download")
  expect(cloudCopyKey({ workspace: local, revision: 1, savedAt: null })).toBe(
    cloudCopyKey({ workspace: base, revision: 2, savedAt: 123 }),
  )
  const result = compareSchedules(sharedMergeBase(oldBase), local, remote)
  expect(result.unresolved).toHaveLength(0)
  expect(result.workspace?.plans[0]?.courses?.["2026a"]).toEqual([
    { id: "math", groups: ["01", "02"], color: "blue" },
  ])
  expect(JSON.stringify([base, local, remote])).toBe(before)
  expect(scheduleKey(withGroups(["01", "03"]))).not.toBe(scheduleKey(base))
})

test("independent additions and removals merge without resurrection or mutating inputs", () => {
  const base = workspace("math", "literature"),
    local = workspace("literature", "syntax"),
    remote = workspace("math", "literature", "logic")
  const original = JSON.stringify([base, local, remote])
  const result = compareSchedules(base, local, remote)
  expect(ids(result)).toEqual(["literature", "syntax", "logic"])
  expect(result.unresolved).toHaveLength(0)
  expect(JSON.stringify([base, local, remote])).toBe(original)
  expect(
    result.workspace?.plans[0]?.courses?.["2026a"]?.every(
      (course) => course.note === "keep",
    ),
  ).toBe(true)
  expect(sharedMergeBase(scheduleKey(base))?.plans).toEqual(base.plans)
})
test("same-course and delete/edit conflicts preserve unrelated additions for either explicit choice", () => {
  const base = workspace("math"),
    local = workspace("syntax"),
    remote = workspace("math", "logic")
  remote.plans[0]!.courses!["2026a"]![0]!.groups = ["02"]
  const result = compareSchedules(base, local, remote)
  expect(result.unresolved).toHaveLength(1)
  expect(result.workspace).toBeUndefined()
  const key = result.unresolved[0]!.key
  expect(
    ids(compareSchedules(base, local, remote, { [key]: "local" })),
  ).toEqual(["syntax", "logic"])
  expect(
    ids(compareSchedules(base, local, remote, { [key]: "remote" })),
  ).toEqual(["math", "syntax", "logic"])
})
test("annual semesters and pending intent are one course/year decision", () => {
  const base = workspace("annual"),
    local = structuredClone(base),
    remote = structuredClone(base)
  local.plans[0]!.courses!["2026b"] = [{ id: "annual", groups: ["02"] }]
  local.plans[0]!.pendingAnnualChanges = [
    { semester: "2026b", id: "annual", groups: ["02"] },
  ]
  remote.plans[0]!.courses!["2026a"]![0]!.groups = ["03"]
  const result = compareSchedules(base, local, remote)
  expect(result.unresolved).toHaveLength(1)
  const chosen = compareSchedules(base, local, remote, {
    [result.unresolved[0]!.key]: "local",
  }).workspace!
  expect(chosen.plans[0]!.courses).toEqual(local.plans[0]!.courses)
  expect(chosen.plans[0]!.pendingAnnualChanges).toEqual(
    local.plans[0]!.pendingAnnualChanges,
  )
})
test("plan deletion versus editing, missing baseline, duplicate IDs and all-plan deletion cannot silently merge", () => {
  const base = workspace("math")
  base.plans.push({ id: "second", name: "Other", courses: {} })
  const local = { ...base, plans: [base.plans[0]!] },
    remote = structuredClone(base)
  remote.plans[1]!.name = "Edited"
  expect(compareSchedules(base, local, remote).unresolved[0]?.kind).toBe("plan")
  expect(compareSchedules(undefined, local, remote).workspace).toBeUndefined()
  expect(compareSchedules(undefined, local, local).changes).toHaveLength(0)
  expect(
    compareSchedules(base, workspace("math", "math"), remote).reason,
  ).toContain("יותר מפעם")
  expect(
    compareSchedules(base, local, {
      ...base,
      activePlanId: "second",
      plans: [base.plans[1]!],
    }).workspace,
  ).toBeUndefined()
})
test("ordering, unknown metadata and custom-catalog dependencies are explicit", () => {
  const base = workspace("a", "b", "c"),
    local = workspace("b", "a", "c"),
    remote = workspace("a", "c", "b")
  const result = compareSchedules(base, local, remote)
  expect(result.unresolved.map((row) => row.kind)).toEqual(["order"])
  expect(
    ids(
      compareSchedules(base, local, remote, {
        [result.unresolved[0]!.key]: "remote",
      }),
    ),
  ).toEqual(["a", "c", "b"])
  const extra = { ...base, userMetadata: { retained: true } }
  expect(
    (
      compareSchedules(base, extra, workspace("a", "b", "c", "d"))
        .workspace as typeof extra
    ).userMetadata,
  ).toEqual({ retained: true })
  const catalog = {
    ...base,
    customCourses: { local: { x: { name: "Custom" } } },
  }
  const selections = workspace("a", "b", "c", "d")
  for (const [local, remote] of [
    [catalog, selections],
    [selections, catalog],
  ]) {
    const merged = compareSchedules(base, local!, remote!)
    expect(merged.reason).toBeUndefined()
    expect(ids(merged)).toEqual(["a", "b", "c", "d"])
    expect(merged.workspace?.customCourses).toEqual(catalog.customCourses)
  }
})

test("retired fields stay preserved but never become merge choices", () => {
  const base = workspace("a"),
    local = workspace("a", "b"),
    remote = workspace("a", "c")
  const withArchive = (value: typeof base, semester: string) => ({
    ...value,
    courses: { historic: [{ id: semester }] },
    pendingAnnualChanges: { historic: semester },
    plans: value.plans.map((plan) => ({
      ...plan,
      semester,
      theme: { historic: semester },
      userMetadata: "keep",
    })),
  })
  const result = compareSchedules(
    withArchive(base, "base"),
    withArchive(local, "local"),
    withArchive(remote, "remote"),
  )
  expect(result.unresolved).toHaveLength(0)
  expect(ids(result)).toEqual(["a", "b", "c"])
  expect(result.changes.every((change) => change.kind === "course")).toBe(true)
  expect(result.workspace?.plans[0]?.semester).toBe("local")
  expect(result.workspace?.plans[0]?.theme).toEqual({ historic: "local" })
  expect(result.workspace?.plans[0]?.userMetadata).toBe("keep")
  expect(result.workspace?.courses).toEqual({ historic: [{ id: "local" }] })
  const extra = {
    ...remote,
    plans: [
      ...remote.plans,
      { id: "new", name: "Remote plan", semester: "archived", courses: {} },
    ],
  }
  expect(
    compareSchedules(base, local, extra).workspace?.plans.find(
      (plan) => plan.id === "new",
    )?.semester,
  ).toBe("archived")
})

test("first-upgrade merge still combines independent edits with a safe legacy baseline", () => {
  const baseline = JSON.stringify({
    plans: [
      {
        id: "default",
        name: "מערכת השעות שלי",
        semester: "2026b",
        courses: { "2026a": [{ id: "a", groups: ["01"], note: "keep" }] },
      },
    ],
  })
  const base = sharedMergeBase(baseline)
  expect(base).toBeDefined()
  expect(
    ids(compareSchedules(base, workspace("a", "b"), workspace("a", "c"))),
  ).toEqual(["a", "b", "c"])
  expect(
    sharedMergeBase(
      JSON.stringify({ schemaVersion: 2, plans: workspace("a").plans }),
    ),
  ).toBeUndefined()
})

test("reimported catalog precedence cannot merge another copy's semester selection", () => {
  const annual = {
    custom: {
      name: "Annual",
      groups: [{ group: "01", lessons: [{ type: "שנתי" }] }],
    },
  }
  const semester = {
    custom: {
      name: "Semester",
      groups: [{ group: "01", lessons: [{ type: "סמסטריאלי" }] }],
    },
  }
  const baseline = {
    ...workspace(),
    customCourses: { "a-annual.json": annual, "z-semester.json": semester },
  }
  // Settings removes a source and appends the reimported file, changing the winner.
  const removed = updateActivePlan(baseline, {
    ...activePlanView(baseline),
    customCourses: { "z-semester.json": semester },
  })
  const local = updateActivePlan(removed, {
    ...activePlanView(removed),
    theme: "google",
    customCourses: { ...removed.customCourses, "a-annual.json": annual },
  })
  const remote = updateActivePlan(baseline, {
    ...activePlanView(baseline),
    courses: { "2026a": [{ id: "custom", groups: ["01"] }] },
  })
  const original = JSON.stringify([baseline, local, remote])
  expect(annualGroupIds(activePlanView(local), "2026a", "custom")).toEqual([
    "01",
  ])
  expect(annualGroupIds(activePlanView(remote), "2026a", "custom")).toEqual([])
  expect(remote.plans[0]!.courses?.["2026b"]).toBeUndefined()
  const base = sharedMergeBase(scheduleKey(baseline))!
  const key = JSON.stringify(["setting", "customCourses"])
  for (const [left, right] of [
    [local, remote],
    [remote, local],
  ] as const) {
    const result = compareSchedules(base, left, right)
    expect(result.reason).toContain("קורסים האישיים")
    expect(result.workspace).toBeUndefined()
    expect(result.changes.find((change) => change.key === key)).toMatchObject({
      local: left.customCourses,
      remote: right.customCourses,
    })
    expect(
      compareSchedules(base, left, right, { [key]: "local" }).workspace,
    ).toBeUndefined()
    expect(
      compareSchedules(base, left, right, { [key]: "remote" }).workspace,
    ).toBeUndefined()
  }
  expect(JSON.stringify([baseline, local, remote])).toBe(original)
})

test("source precedence survives receipts and merges an independent edit without a choice", () => {
  const first = { custom: { name: "First" } },
    second = { custom: { name: "Second" } }
  const baseline = { ...workspace(), customCourses: { first, second } }
  const reordered = { ...baseline, customCourses: { second, first } }
  const base = sharedMergeBase(scheduleKey(reordered))!
  expect(Object.keys(base.customCourses!)).toEqual(["second", "first"])
  const key = JSON.stringify(["setting", "customCourses"])
  expect(
    compareSchedules(undefined, baseline, reordered).changes.some(
      (change) => change.key === key,
    ),
  ).toBe(true)
  const renamed = {
    ...reordered,
    plans: reordered.plans.map((plan) => ({
      ...plan,
      name: "Independent name",
    })),
  }
  const merged = compareSchedules(base, renamed, baseline)
  expect(merged.unresolved).toHaveLength(0)
  expect(merged.workspace?.plans[0]?.name).toBe("Independent name")
  expect(Object.keys(merged.workspace!.customCourses!)).toEqual([
    "first",
    "second",
  ])
  const competing = {
    ...reordered,
    customCourses: {
      ...reordered.customCourses,
      extra: { other: { name: "Another course" } },
    },
  }
  expect(
    compareSchedules(base, competing, baseline).unresolved.map(
      (change) => change.key,
    ),
  ).toEqual([key])
  // Agreeing current copies need no inferred choice about historical source order.
  expect(
    compareSchedules(base, reordered, reordered).workspace?.customCourses,
  ).toEqual(reordered.customCourses)
  expect(
    Object.keys(
      compareSchedules(base, reordered, reordered).workspace!.customCourses!,
    ),
  ).toEqual(["second", "first"])
})

test("catalog comparison ignores inner field order and permits independent source additions", () => {
  const course = { name: "Custom", groups: [{ group: "01", lessons: [] }] }
  const baseline = {
    ...workspace(),
    customCourses: { first: { custom: course } },
  }
  const local = {
    ...baseline,
    theme: "google" as const,
    customCourses: {
      first: { custom: { groups: course.groups, name: course.name } },
    },
  }
  const result = compareSchedules(
    sharedMergeBase(scheduleKey(baseline)),
    local,
    baseline,
  )
  expect(result.reason).toBeUndefined()
  expect(result.changes.map((change) => change.key)).toEqual([
    JSON.stringify(["setting", "theme"]),
  ])
  const remote = {
    ...baseline,
    customCourses: {
      ...baseline.customCourses,
      second: { extra: { name: "Extra" } },
    },
  }
  const merged = compareSchedules(
    sharedMergeBase(scheduleKey(baseline)),
    local,
    remote,
  )
  expect(merged.reason).toBeUndefined()
  expect(merged.workspace).toMatchObject({
    theme: "google",
    customCourses: remote.customCourses,
  })
  expect(Object.keys(merged.workspace!.customCourses!)).toEqual([
    "first",
    "second",
  ])
})

test("harmless source reordering does not compete with an independent import", () => {
  for (const overlap of [{}, { shared: { name: "Identical" } }]) {
    const first = { one: { name: "One" }, ...overlap }
    const second = { two: { name: "Two" }, ...overlap }
    const baseline = { ...workspace(), customCourses: { first, second } }
    const reordered = { ...baseline, customCourses: { second, first } }
    const imported = {
      ...baseline,
      customCourses: { first, second, extra: { three: { name: "Three" } } },
    }
    const base = sharedMergeBase(scheduleKey(baseline))!
    for (const [local, remote] of [
      [reordered, imported],
      [imported, reordered],
    ]) {
      const result = compareSchedules(base, local!, remote!)
      expect(result.unresolved).toHaveLength(0)
      expect(result.workspace?.customCourses).toEqual(imported.customCourses)
    }
    expect(compareSchedules(base, reordered, baseline).changes).toHaveLength(0)
  }
})

test("catalog answers survive harmless order changes but expire when a winner changes", () => {
  const base = workspace()
  const first = { shared: { name: "First" } }
  const second = { shared: { name: "Second" } }
  const independent = { other: { name: "Other" } }
  const local = { ...base, customCourses: { first, second, independent } }
  const remote = { ...base, customCourses: { alternative: first } }
  const previous = compareSchedules(base, local, remote)
  const key = JSON.stringify(["setting", "customCourses"])
  const choices = { [key]: "local" as const }
  const unchanged = { ...local, customCourses: { independent, first, second } }
  expect(
    recheckScheduleChoices(base, unchanged, remote, previous.changes, choices)
      .choices,
  ).toEqual(choices)
  const changed = { ...local, customCourses: { second, first, independent } }
  expect(
    recheckScheduleChoices(base, changed, remote, previous.changes, choices)
      .choices,
  ).toEqual({})
})

test("sorted baselines do not invent catalog changes or source-removal conflicts", () => {
  const z = { first: { name: "First" } },
    a = { second: { name: "Second" } }
  const baseline = { ...workspace(), customCourses: { z, a } }
  const base = sharedMergeBase(scheduleKey(baseline))!
  const local = { ...baseline, theme: "google" as const }
  const selected = {
    ...workspace("unrelated"),
    customCourses: baseline.customCourses,
  }
  const result = compareSchedules(base, local, selected)
  expect(result.reason).toBeUndefined()
  expect(
    result.changes.some(
      (change) => change.key === JSON.stringify(["setting", "customCourses"]),
    ),
  ).toBe(false)
  expect(result.workspace).toMatchObject({
    theme: "google",
    plans: selected.plans,
  })
  for (const customCourses of [
    { z },
    { z, a, extra: { third: { name: "Third" } } },
  ]) {
    const merged = compareSchedules(base, local, { ...baseline, customCourses })
    expect(merged.reason).toBeUndefined()
    expect(merged.unresolved).toHaveLength(0)
    expect(merged.workspace).toMatchObject({ theme: "google", customCourses })
    expect(Object.keys(merged.workspace!.customCourses!)).toEqual(
      Object.keys(customCourses),
    )
  }
})

test("only decisions whose actual alternatives changed need another answer", () => {
  const base = workspace("math")
  const withChanges = (group: string, name: string) => ({
    ...base,
    plans: base.plans.map((plan) => ({
      ...plan,
      name,
      courses: { "2026a": [{ id: "math", groups: [group], note: "keep" }] },
    })),
  })
  const local = withChanges("02", "Local name")
  const remote = withChanges("03", "Remote name")
  const previous = compareSchedules(base, local, remote).changes
  const answers = Object.fromEntries(
    previous
      .filter((change) => change.conflict)
      .map((change) => [change.key, "local" as const]),
  )
  expect(Object.keys(answers)).toHaveLength(2)
  const changed = compareSchedules(
    base,
    local,
    withChanges("04", "Remote name"),
  ).changes
  const retained = retainMergeChoices(previous, changed, answers)
  expect(Object.keys(retained)).toEqual(
    previous
      .filter((change) => change.kind !== "course" && change.conflict)
      .map((change) => change.key),
  )
  const unrelated = compareSchedules(
    base,
    { ...local, theme: "apple" },
    remote,
  ).changes
  expect(retainMergeChoices(previous, unrelated, answers)).toEqual(answers)
})

test("catalog dependency checks follow the edited course across plans, semesters and pending annual intent", () => {
  const base = workspace("math", "other")
  const catalog = {
    ...base,
    customCourses: {
      imported: {
        math: {
          name: "Math",
          groups: [{ group: "01", lessons: [{ type: "שנתי" }] }],
        },
      },
    },
  }
  const changed = (id: string) => ({
    ...base,
    plans: base.plans.map((plan) => ({
      ...plan,
      courses: {
        "2026a": plan.courses!["2026a"]!.map((course) =>
          course.id === id ? { ...course, groups: ["02"] } : course,
        ),
      },
    })),
  })
  const unrelated = changed("other")
  const otherPlan = {
    ...base,
    plans: [
      ...base.plans,
      {
        id: "another",
        name: "Another",
        courses: { "2027b": [{ id: "math", groups: ["02"] }] },
      },
    ],
  }
  const pending = {
    ...base,
    plans: base.plans.map((plan) => ({
      ...plan,
      pendingAnnualChanges: [{ id: "math", semester: "2026b", groups: ["02"] }],
    })),
  }
  for (const edits of [
    changed("math"),
    workspace("other"),
    otherPlan,
    pending,
  ] as const) {
    for (const [local, remote] of [
      [catalog, edits],
      [edits, catalog],
    ] as const) {
      const result = compareSchedules(
        sharedMergeBase(scheduleKey(base)),
        local,
        remote,
      )
      expect(result.reason).toContain("קורסים האישיים")
      expect(result.workspace).toBeUndefined()
    }
  }
  for (const [local, remote] of [
    [catalog, unrelated],
    [unrelated, catalog],
  ] as const) {
    const result = compareSchedules(
      sharedMergeBase(scheduleKey(base)),
      local,
      remote,
    )
    expect(result.reason).toBeUndefined()
    expect(result.workspace?.plans).toEqual(unrelated.plans)
    expect(result.workspace?.customCourses).toEqual(catalog.customCourses)
  }
})

test("catalog edits do not turn course styling or plan navigation into a dependent selection", () => {
  const base = workspace("math")
  const catalog = {
    ...base,
    customCourses: { imported: { math: { name: "Changed definition" } } },
  }
  const styled = {
    ...base,
    tab: "practice",
    plans: base.plans.map((plan) => ({
      ...plan,
      name: "Renamed",
      courses: {
        "2026a": plan.courses!["2026a"]!.map((course) => ({
          ...course,
          color: "#ffffff",
          studyPlanCategory: "Electives",
        })),
      },
    })),
  }
  for (const [local, remote] of [
    [catalog, styled],
    [styled, catalog],
  ] as const) {
    const result = compareSchedules(base, local, remote)
    expect(result.reason).toBeUndefined()
    expect(result.workspace?.plans).toEqual(styled.plans)
    expect(result.workspace?.customCourses).toEqual(catalog.customCourses)
  }
})

test("shadowed definition edits do not block a selection, but removing the winning source does", () => {
  const hidden = { math: { name: "Hidden" } }
  const winner = { math: { name: "Used" } }
  const base = { ...workspace("math"), customCourses: { hidden, winner } }
  const edited = {
    ...base,
    plans: base.plans.map((plan) => ({
      ...plan,
      courses: { "2026a": [{ id: "math", groups: ["02"], note: "keep" }] },
    })),
  }
  const catalog = {
    ...base,
    customCourses: { hidden: { math: { name: "Still hidden" } }, winner },
  }
  const before = JSON.stringify([base, edited, catalog])
  for (const [local, remote] of [
    [catalog, edited],
    [edited, catalog],
  ] as const) {
    const result = compareSchedules(
      sharedMergeBase(scheduleKey(base)),
      local,
      remote,
    )
    expect(result.reason).toBeUndefined()
    expect(result.workspace?.plans).toEqual(edited.plans)
    expect(result.workspace?.customCourses).toEqual(catalog.customCourses)
  }
  expect(JSON.stringify([base, edited, catalog])).toBe(before)
  const removed = { ...base, customCourses: { hidden } }
  for (const [local, remote] of [
    [removed, edited],
    [edited, removed],
  ] as const) {
    expect(
      compareSchedules(sharedMergeBase(scheduleKey(base)), local, remote)
        .reason,
    ).toContain("קורסים האישיים")
  }
})

test("source reordering with no changed winner remains independent even alongside new definitions", () => {
  const first = { one: { name: "One" }, shared: { name: "Identical" } }
  const second = { two: { name: "Two" }, shared: { name: "Identical" } }
  const base = { ...workspace("one"), customCourses: { first, second } }
  const local = {
    ...base,
    customCourses: { second, first, extra: { third: { name: "New" } } },
  }
  const remote = { ...base, plans: workspace("one", "other").plans }
  for (const [left, right] of [
    [local, remote],
    [remote, local],
  ] as const) {
    const result = compareSchedules(
      sharedMergeBase(scheduleKey(base)),
      left,
      right,
    )
    expect(result.reason).toBeUndefined()
    expect(result.workspace?.plans).toEqual(remote.plans)
    expect(result.workspace?.customCourses).toEqual(local.customCourses)
  }
})

test("retaining a deleted course reveals its ordering choice and retains both answers", () => {
  const base = workspace("a", "b", "c")
  const local = workspace("b", "a")
  const remote = workspace("c", "a", "b")
  remote.plans[0]!.courses!["2026a"]![0]!.color = "red"
  const initial = compareSchedules(base, local, remote)
  const courseKey = initial.unresolved[0]!.key
  const selected = recheckScheduleChoices(
    base,
    local,
    remote,
    initial.changes,
    { [courseKey]: "remote" },
  )
  expect(selected.unresolved.map((change) => change.kind)).toEqual(["order"])
  const orderKey = selected.unresolved[0]!.key
  const choices = { ...selected.choices, [orderKey]: "local" as const }
  const resolved = recheckScheduleChoices(
    base,
    local,
    remote,
    selected.changes,
    choices,
  )
  expect(ids(resolved)).toEqual(["b", "a", "c"])
  expect(resolved.workspace!.plans[0]!.courses!["2026a"]![2]!.color).toBe("red")
  const deleted = recheckScheduleChoices(
    base,
    local,
    remote,
    resolved.changes,
    { ...choices, [courseKey]: "local" },
  )
  expect(deleted.choices).toEqual({ [courseKey]: "local" })
  expect(ids(deleted)).toEqual(["b", "a"])
})
