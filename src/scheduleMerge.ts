import { workspaceSchema } from "./schemas"
import type { PlanWorkspace, SchedulePlan } from "./plans"
import {
  decodeWorkspace,
  workspaceContent,
  navigationFields,
  sharedFields,
  planFields,
} from "./workspaceFormat"

export type MergeChoice = "local" | "remote"
export type ScheduleChange = {
  key: string
  label: string
  kind: "course" | "plan" | "order" | "setting"
  courseId?: string
  year?: string
  planName?: string
  base: unknown
  local: unknown
  remote: unknown
  conflict: boolean
}
type Part<T> = { value: T | undefined; changes: ScheduleChange[] }
type Bundle = {
  courses: Record<string, unknown>
  pending: NonNullable<SchedulePlan["pendingAnnualChanges"]>
}
const keyOf = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  )
const catalogKey = JSON.stringify(["setting", "customCourses"])
// Source order matters only when it changes which definition wins. Retain
// every source's contents too: shadowed edits and deletions are still real data.
export const catalogContents = (value: unknown) =>
  value && typeof value === "object"
    ? [value, Object.fromEntries(Object.values(value).flatMap(Object.entries))]
    : value
const same = (a: unknown, b: unknown, key?: string) =>
  keyOf(key === catalogKey ? catalogContents(a) : a) ===
  keyOf(key === catalogKey ? catalogContents(b) : b)

/** A decision remains valid only while both alternatives are still the same. */
export const retainMergeChoices = (
  previous: ScheduleChange[],
  current: ScheduleChange[],
  choices: Record<string, MergeChoice>,
): Record<string, MergeChoice> =>
  Object.fromEntries(
    current.flatMap((change) => {
      const before = previous.find((item) => item.key === change.key)
      const choice = choices[change.key]
      return choice &&
        change.conflict &&
        before?.conflict &&
        same(before.local, change.local, change.key) &&
        same(before.remote, change.remote, change.key)
        ? [[change.key, choice]]
        : []
    }),
  )
const union = <T>(...values: T[][]) => [...new Set(values.flat())]
// Practice markers are independent memberships: keep removals as well as additions.
const mergeMemberships = (
  before: string[] = [],
  left: string[] = [],
  right: string[] = [],
) =>
  union(before, left, right).filter((id) =>
    left.includes(id) === before.includes(id)
      ? right.includes(id)
      : left.includes(id),
  )
const without = (value: object, names: string[]) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !names.includes(key)),
  )
const picked = (value: object, names: string[]) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => names.includes(key)),
  )
const fieldNames: Record<string, string> = {
  theme: "עיצוב",
  customCourses: "קורסים אישיים",
  practicedExams: "מבחנים שתורגלו",
  openedPracticeCourses: "קורסים לתרגול",
}
const courseBundles = (plan: SchedulePlan): Record<string, Bundle> => {
  const entries = Object.entries(plan.courses ?? {}).flatMap(
    ([semester, courses]) => courses.map((course) => ({ semester, course })),
  )
  const pending = plan.pendingAnnualChanges ?? []
  const keys = union(
    entries.map(({ semester, course }) =>
      JSON.stringify([semester.slice(0, 4), course.id]),
    ),
    pending.map((change) =>
      JSON.stringify([change.semester.slice(0, 4), change.id]),
    ),
  )
  return Object.fromEntries(
    keys.map((key) => {
      const [year, id] = JSON.parse(key) as [string, string]
      return [
        key,
        {
          courses: Object.fromEntries(
            entries
              .filter(
                (item) =>
                  item.semester.slice(0, 4) === year && item.course.id === id,
              )
              .map((item) => [item.semester, item.course]),
          ),
          pending: pending.filter(
            (change) =>
              change.semester.slice(0, 4) === year && change.id === id,
          ),
        },
      ]
    }),
  )
}
const duplicateCourses = (workspace: PlanWorkspace) =>
  workspace.plans.some((plan) =>
    Object.values(plan.courses ?? {}).some(
      (courses) =>
        new Set(courses.map((course) => course.id)).size !== courses.length,
    ),
  )

// Use the same last-source-wins rule as the displayed catalog.
const catalogDefinitions = (workspace: PlanWorkspace) =>
  Object.fromEntries(
    Object.values(workspace.customCourses ?? {}).flatMap(Object.entries),
  )

const courseSelections = (workspace: PlanWorkspace, id: string) =>
  Object.fromEntries(
    workspace.plans.flatMap((plan) => {
      const courses = Object.fromEntries(
        Object.entries(plan.courses ?? {}).flatMap(([semester, rows]) => {
          const course = rows.find((row) => row.id === id)
          // Presentation edits do not depend on the imported definition.
          return course
            ? [
                [
                  semester,
                  without(course, ["id", "color", "studyPlanCategory"]),
                ],
              ]
            : []
        }),
      )
      const pending = (plan.pendingAnnualChanges ?? []).filter(
        (change) => change.id === id,
      )
      return Object.keys(courses).length || pending.length
        ? [[plan.id, { courses, pending }]]
        : []
    }),
  )

/** One comparison powers both the user-visible deltas and the resulting workspace. */
export const compareSchedules = (
  baseInput: PlanWorkspace | undefined,
  localInput: PlanWorkspace,
  remoteInput: PlanWorkspace,
  choices: Record<string, MergeChoice> = {},
) => {
  const originalLocal = decodeWorkspace(localInput),
    originalRemote = decodeWorkspace(remoteInput)
  const semantic = (value: PlanWorkspace): PlanWorkspace =>
    ({
      ...workspaceContent(value),
      activePlanId: value.activePlanId,
      ...picked(value, navigationFields),
    }) as PlanWorkspace
  const base = baseInput ? semantic(decodeWorkspace(baseInput)) : undefined
  const local = semantic(originalLocal),
    remote = semantic(originalRemote)
  const choose = <T>(
    before: T | undefined,
    left: T | undefined,
    right: T | undefined,
    context: Omit<ScheduleChange, "base" | "local" | "remote" | "conflict">,
  ): Part<T> => {
    const unchangedLeft = same(before, left, context.key),
      unchangedRight = same(before, right, context.key)
    const equalCopies = same(left, right, context.key)
    if (unchangedLeft && unchangedRight && equalCopies)
      return { value: left, changes: [] }
    const conflict = !equalCopies && !unchangedLeft && !unchangedRight
    const choice = choices[context.key]
    return {
      value: conflict
        ? choice === "local"
          ? left
          : choice === "remote"
            ? right
            : undefined
        : unchangedLeft
          ? right
          : left,
      changes: [
        { ...context, base: before, local: left, remote: right, conflict },
      ],
    }
  }
  const order = (
    before: string[],
    left: string[],
    right: string[],
    ids: string[],
    path: string,
    label: string,
  ): Part<string[]> => {
    const b = before.filter((id) => ids.includes(id)),
      l = left.filter((id) => ids.includes(id)),
      r = right.filter((id) => ids.includes(id))
    const appendOnly = (list: string[]) => {
      const existing = list.filter((id) => b.includes(id))
      return (
        same(
          existing,
          b.filter((id) => list.includes(id)),
        ) && same(list.slice(0, existing.length), existing)
      )
    }
    const simpleLeft = appendOnly(l),
      simpleRight = appendOnly(r)
    if (simpleLeft && simpleRight)
      return { value: union(b, l, r, ids), changes: [] }
    const result = choose(b, simpleLeft ? b : l, simpleRight ? b : r, {
      key: path,
      label,
      kind: "order",
    })
    return {
      ...result,
      value: result.value ? union(result.value, l, r, ids) : undefined,
    }
  }
  const mergePlan = (
    before: SchedulePlan | undefined,
    left: SchedulePlan | undefined,
    right: SchedulePlan | undefined,
    id: string,
  ): Part<SchedulePlan> => {
    const label = left?.name ?? right?.name ?? before!.name
    const path = JSON.stringify(["plan", id])
    if (!before || !left || !right)
      return choose(before, left, right, {
        key: path,
        label,
        kind: "plan",
        planName: label,
      })
    // Names are independent; the academic context must remain a coherent choice.
    const academicFields = ["school", "studyPlan", "degreeStartYear"]
    const metadata = [
      { key: "name", label: "שם המערכת", fields: ["name"] },
      { key: "academic", label: "חוג ותוכנית לימודים", fields: academicFields },
      {
        key: "other",
        label: "הגדרות נוספות",
        fields: union(
          Object.keys(before),
          Object.keys(left),
          Object.keys(right),
        ).filter(
          (key) =>
            ![
              "courses",
              "pendingAnnualChanges",
              "name",
              ...academicFields,
            ].includes(key),
        ),
      },
    ].map((group) =>
      choose(
        picked(before, group.fields),
        picked(left, group.fields),
        picked(right, group.fields),
        {
          key: JSON.stringify(["plan", id, group.key]),
          label: `${label} — ${group.label}`,
          kind: "setting",
          planName: label,
        },
      ),
    )
    const b = courseBundles(before),
      l = courseBundles(left),
      r = courseBundles(right)
    const bundles = union(Object.keys(b), Object.keys(l), Object.keys(r)).map(
      (key) => {
        const [year, courseId] = JSON.parse(key) as [string, string]
        return choose(b[key], l[key], r[key], {
          key: JSON.stringify(["course", id, key]),
          label: courseId,
          kind: "course",
          courseId,
          year,
          planName: label,
        })
      },
    )
    const kept = bundles.flatMap((part) => (part.value ? [part.value] : []))
    const semesters = union(
      Object.keys(before.courses ?? {}),
      Object.keys(left.courses ?? {}),
      Object.keys(right.courses ?? {}),
    )
    const ordered = semesters.map((semester) => {
      const courses = kept.flatMap((bundle) =>
        bundle.courses[semester]
          ? [
              bundle.courses[semester] as NonNullable<
                SchedulePlan["courses"]
              >[string][number],
            ]
          : [],
      )
      const sequence = order(
        before.courses?.[semester]?.map((course) => course.id) ?? [],
        left.courses?.[semester]?.map((course) => course.id) ?? [],
        right.courses?.[semester]?.map((course) => course.id) ?? [],
        courses.map((course) => course.id),
        JSON.stringify(["order", id, semester]),
        `${label} — סדר קורסים ${semester}`,
      )
      return {
        semester,
        courses: (sequence.value ?? courses.map((course) => course.id)).map(
          (id) => courses.find((course) => course.id === id)!,
        ),
        changes: sequence.changes,
      }
    })
    const pending = kept.flatMap((bundle) => bundle.pending)
    return {
      value: {
        ...Object.fromEntries(
          metadata.flatMap((part) => Object.entries(part.value ?? {})),
        ),
        ...(semesters.length
          ? {
              courses: Object.fromEntries(
                ordered.map((item) => [item.semester, item.courses]),
              ),
            }
          : {}),
        ...(pending.length ? { pendingAnnualChanges: pending } : {}),
      } as SchedulePlan,
      changes: [
        ...metadata.flatMap((part) => part.changes),
        ...bundles.flatMap((part) => part.changes),
        ...ordered.flatMap((item) => item.changes),
      ],
    }
  }
  // A missing baseline supports an honest two-copy comparison, never deletion inference or merging.
  const baseline = base ?? { ...local, plans: [] }
  const plans = union(
    baseline.plans.map((plan) => plan.id),
    local.plans.map((plan) => plan.id),
    remote.plans.map((plan) => plan.id),
  ).map((id) =>
    mergePlan(
      baseline.plans.find((plan) => plan.id === id),
      local.plans.find((plan) => plan.id === id),
      remote.plans.find((plan) => plan.id === id),
      id,
    ),
  )
  const keptPlans = plans.flatMap((part) => (part.value ? [part.value] : []))
  const planOrder = order(
    baseline.plans.map((plan) => plan.id),
    local.plans.map((plan) => plan.id),
    remote.plans.map((plan) => plan.id),
    keptPlans.map((plan) => plan.id),
    "plan-order",
    "סדר מערכות השעות",
  )
  const shared = [baseline, local, remote].map((value) =>
    without(value, ["plans", "activePlanId", "semester", "tab"]),
  )
  const mergeSetting = (key: string): Part<unknown> => {
    const result = choose(shared[0]![key], shared[1]![key], shared[2]![key], {
      key: JSON.stringify(["setting", key]),
      label: fieldNames[key] ?? `נתונים נוספים: ${key}`,
      kind: "setting",
    })
    if (!base || !result.changes.some((change) => change.conflict))
      return result
    if (key !== "openedPracticeCourses" && key !== "practicedExams")
      return result
    const value =
      key === "openedPracticeCourses"
        ? mergeMemberships(
            base.openedPracticeCourses,
            local.openedPracticeCourses,
            remote.openedPracticeCourses,
          )
        : Object.fromEntries(
            union(
              Object.keys(base.practicedExams ?? {}),
              Object.keys(local.practicedExams ?? {}),
              Object.keys(remote.practicedExams ?? {}),
            ).map((id) => [
              id,
              mergeMemberships(
                base.practicedExams?.[id],
                local.practicedExams?.[id],
                remote.practicedExams?.[id],
              ),
            ]),
          )
    return {
      value,
      changes: result.changes.map((change) => ({ ...change, conflict: false })),
    }
  }
  const settings = union(...shared.map((value) => Object.keys(value))).map(
    (key) => ({
      key,
      result: mergeSetting(key),
    }),
  )
  const changes = [
    ...plans.flatMap((part) => part.changes),
    ...planOrder.changes,
    ...settings.flatMap((item) => item.result.changes),
  ].filter((change) => base || !same(change.local, change.remote, change.key))
  const unresolved = changes.filter(
    (change) => change.conflict && !choices[change.key],
  )
  const list = (planOrder.value ?? keptPlans.map((plan) => plan.id)).map(
    (id) => keptPlans.find((plan) => plan.id === id)!,
  )
  const parsed = workspaceSchema.safeParse({
    // Retired fields are opaque recovery data: keep local values, or the remote copy for a new plan.
    ...picked(originalLocal, [...planFields, "pendingAnnualChanges"]),
    ...Object.fromEntries(
      settings
        .filter((item) => item.result.value !== undefined)
        .map((item) => [item.key, item.result.value]),
    ),
    plans: list.map((plan) => ({
      ...picked(
        originalLocal.plans.find((item) => item.id === plan.id) ??
          originalRemote.plans.find((item) => item.id === plan.id)!,
        [...navigationFields, ...sharedFields, "activePlanId"],
      ),
      ...plan,
    })),
    activePlanId: list.some((plan) => plan.id === local.activePlanId)
      ? local.activePlanId
      : list[0]?.id,
    ...(local.semester !== undefined ? { semester: local.semester } : {}),
    ...(local.tab !== undefined ? { tab: local.tab } : {}),
  })
  const localDefinitions = catalogDefinitions(local),
    remoteDefinitions = catalogDefinitions(remote)
  const differentDefinitions = union(
    Object.keys(localDefinitions),
    Object.keys(remoteDefinitions),
  ).filter((id) => !same(localDefinitions[id], remoteDefinitions[id]))

  const baseDefinitions = base ? catalogDefinitions(base) : {}
  const affectsSelections = (catalog: PlanWorkspace, edited: PlanWorkspace) => {
    if (!base) return false
    const definitions = catalogDefinitions(catalog)
    return differentDefinitions.some(
      (id) =>
        !same(baseDefinitions[id], definitions[id]) &&
        !same(courseSelections(base, id), courseSelections(edited, id)),
    )
  }
  const coupled =
    affectsSelections(local, remote) || affectsSelections(remote, local)
  const reason = !base
    ? "אין עותק משותף קודם להשוואה בטוחה. מוצגים ההבדלים בין העותקים בלבד."
    : [base, local, remote].some(duplicateCourses)
      ? "קורס מופיע יותר מפעם אחת באותו סמסטר. יש לתקן את העותק לפני מיזוג."
      : coupled
        ? "שינוי בקורסים האישיים עשוי להשפיע על בחירות הקורסים בעותק השני. השתמשו בבחירת עותק מלא."
        : !parsed.success && !unresolved.length
          ? "התוצאה אינה מערכת תקינה (למשל, נמחקו כל המערכות). בחרו עותק מלא או שנו את הבחירות."
          : undefined
  return {
    changes,
    unresolved,
    reason,
    workspace:
      !reason && !unresolved.length && parsed.success ? parsed.data : undefined,
  }
}

export const workspaceSummary = (workspace: PlanWorkspace) =>
  workspace.plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    semesters: Object.entries(plan.courses ?? {}).map(
      ([semester, courses]) => ({ semester, count: courses.length }),
    ),
  }))

/** Membership choices can reveal ordering choices. Revalidate until no stale answer remains. */
export const recheckScheduleChoices = (
  base: PlanWorkspace | undefined,
  local: PlanWorkspace,
  remote: PlanWorkspace,
  previous: ScheduleChange[],
  choices: Record<string, MergeChoice>,
): ReturnType<typeof compareSchedules> & {
  choices: Record<string, MergeChoice>
} => {
  const comparison = compareSchedules(base, local, remote, choices)
  const retained = retainMergeChoices(previous, comparison.changes, choices)
  return Object.keys(retained).length === Object.keys(choices).length
    ? { ...comparison, choices: retained }
    : recheckScheduleChoices(base, local, remote, previous, retained)
}
