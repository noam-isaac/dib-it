import { workspaceSchema } from "./schemas"
import { z } from "zod"
import type { PlanWorkspace, SchedulePlan } from "./plans"

export type MergeChoice = "local" | "remote"
export type ScheduleChange = {
  key: string; label: string; kind: "course" | "plan" | "order" | "setting"
  courseId?: string; year?: string; planName?: string
  base: unknown; local: unknown; remote: unknown; conflict: boolean
}
type Part<T> = { value: T | undefined; changes: ScheduleChange[] }
type Bundle = { courses: Record<string, unknown>; pending: NonNullable<SchedulePlan["pendingAnnualChanges"]> }
const keyOf = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const same = (a: unknown, b: unknown) => keyOf(a) === keyOf(b)
const union = <T>(...values: T[][]) => [...new Set(values.flat())]
const without = (value: object, names: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !names.includes(key)))
const fieldNames: Record<string, string> = {
  theme: "עיצוב", customCourses: "קורסים אישיים", practicedExams: "מבחנים שתורגלו", openedPracticeCourses: "קורסים לתרגול",
}
export const sharedMergeBase = (key: string | null | undefined): PlanWorkspace | undefined => {
  if (!key) return undefined
  try {
    const value = z.object({ plans: z.array(z.object({ id: z.string() })).min(1) }).passthrough().parse(JSON.parse(key))
    return workspaceSchema.parse({ ...JSON.parse(key) as Record<string, unknown>, activePlanId: value.plans[0]!.id })
  } catch { return undefined }
}
const courseBundles = (plan: SchedulePlan): Record<string, Bundle> => {
  const entries = Object.entries(plan.courses ?? {}).flatMap(([semester, courses]) => courses.map(course => ({ semester, course })))
  const pending = plan.pendingAnnualChanges ?? []
  const keys = union(entries.map(({ semester, course }) => JSON.stringify([semester.slice(0, 4), course.id])), pending.map(change => JSON.stringify([change.semester.slice(0, 4), change.id])))
  return Object.fromEntries(keys.map(key => {
    const [year, id] = JSON.parse(key) as [string, string]
    return [key, {
      courses: Object.fromEntries(entries.filter(item => item.semester.slice(0, 4) === year && item.course.id === id).map(item => [item.semester, item.course])),
      pending: pending.filter(change => change.semester.slice(0, 4) === year && change.id === id),
    }]
  }))
}
const duplicateCourses = (workspace: PlanWorkspace) => workspace.plans.some(plan => Object.values(plan.courses ?? {}).some(courses => new Set(courses.map(course => course.id)).size !== courses.length))

/** One comparison powers both the user-visible deltas and the resulting workspace. */
export const compareSchedules = (base: PlanWorkspace | undefined, local: PlanWorkspace, remote: PlanWorkspace, choices: Record<string, MergeChoice> = {}) => {
  const choose = <T>(before: T | undefined, left: T | undefined, right: T | undefined, context: Omit<ScheduleChange, "base" | "local" | "remote" | "conflict">): Part<T> => {
    if (same(before, left) && same(before, right)) return { value: left, changes: [] }
    const conflict = !same(left, right) && !same(left, before) && !same(right, before)
    const choice = choices[context.key]
    return {
      value: conflict ? choice === "local" ? left : choice === "remote" ? right : undefined : same(left, before) ? right : left,
      changes: [{ ...context, base: before, local: left, remote: right, conflict }],
    }
  }
  const order = (before: string[], left: string[], right: string[], ids: string[], path: string, label: string): Part<string[]> => {
    const b = before.filter(id => ids.includes(id)), l = left.filter(id => ids.includes(id)), r = right.filter(id => ids.includes(id))
    const appendOnly = (list: string[]) => {
      const existing = list.filter(id => b.includes(id))
      return same(existing, b.filter(id => list.includes(id))) && same(list.slice(0, existing.length), existing)
    }
    const simpleLeft = appendOnly(l), simpleRight = appendOnly(r)
    if (simpleLeft && simpleRight) return { value: union(b, l, r, ids), changes: [] }
    const result = choose(b, simpleLeft ? b : l, simpleRight ? b : r, { key: path, label, kind: "order" })
    return { ...result, value: result.value ? union(result.value, l, r, ids) : undefined }
  }
  const mergePlan = (before: SchedulePlan | undefined, left: SchedulePlan | undefined, right: SchedulePlan | undefined, id: string): Part<SchedulePlan> => {
    const label = left?.name ?? right?.name ?? before!.name
    const path = JSON.stringify(["plan", id])
    if (!before || !left || !right) return choose(before, left, right, { key: path, label, kind: "plan", planName: label })
    const meta = choose(without(before, ["courses", "pendingAnnualChanges"]), without(left, ["courses", "pendingAnnualChanges"]), without(right, ["courses", "pendingAnnualChanges"]),
      { key: path, label: `${label} — שם והגדרות המערכת`, kind: "plan", planName: label })
    const b = courseBundles(before), l = courseBundles(left), r = courseBundles(right)
    const bundles = union(Object.keys(b), Object.keys(l), Object.keys(r)).map(key => {
      const [year, courseId] = JSON.parse(key) as [string, string]
      return choose(b[key], l[key], r[key], { key: JSON.stringify(["course", id, key]), label: courseId, kind: "course", courseId, year, planName: label })
    })
    const kept = bundles.flatMap(part => part.value ? [part.value] : [])
    const semesters = union(Object.keys(before.courses ?? {}), Object.keys(left.courses ?? {}), Object.keys(right.courses ?? {}))
    const ordered = semesters.map(semester => {
      const courses = kept.flatMap(bundle => bundle.courses[semester] ? [bundle.courses[semester] as NonNullable<SchedulePlan["courses"]>[string][number]] : [])
      const sequence = order(before.courses?.[semester]?.map(course => course.id) ?? [], left.courses?.[semester]?.map(course => course.id) ?? [], right.courses?.[semester]?.map(course => course.id) ?? [], courses.map(course => course.id), JSON.stringify(["order", id, semester]), `${label} — סדר קורסים ${semester}`)
      return { semester, courses: (sequence.value ?? courses.map(course => course.id)).map(id => courses.find(course => course.id === id)!), changes: sequence.changes }
    })
    const pending = kept.flatMap(bundle => bundle.pending)
    return {
      value: { ...(meta.value ?? without(left, ["courses", "pendingAnnualChanges"])),
        ...(semesters.length ? { courses: Object.fromEntries(ordered.map(item => [item.semester, item.courses])) } : {}),
        ...(pending.length ? { pendingAnnualChanges: pending } : {}),
      } as SchedulePlan,
      changes: [...meta.changes, ...bundles.flatMap(part => part.changes), ...ordered.flatMap(item => item.changes)],
    }
  }
  // A missing baseline supports an honest two-copy comparison, never deletion inference or merging.
  const baseline = base ?? { ...local, plans: [] }
  const plans = union(baseline.plans.map(plan => plan.id), local.plans.map(plan => plan.id), remote.plans.map(plan => plan.id)).map(id =>
    mergePlan(baseline.plans.find(plan => plan.id === id), local.plans.find(plan => plan.id === id), remote.plans.find(plan => plan.id === id), id))
  const keptPlans = plans.flatMap(part => part.value ? [part.value] : [])
  const planOrder = order(baseline.plans.map(plan => plan.id), local.plans.map(plan => plan.id), remote.plans.map(plan => plan.id), keptPlans.map(plan => plan.id), "plan-order", "סדר מערכות השעות")
  const shared = [baseline, local, remote].map(value => without(value, ["plans", "activePlanId", "semester", "tab"]))
  const settings = union(...shared.map(value => Object.keys(value))).map(key => ({ key, result: choose(shared[0]![key], shared[1]![key], shared[2]![key], { key: JSON.stringify(["setting", key]), label: fieldNames[key] ?? `נתונים נוספים: ${key}`, kind: "setting" }) }))
  const changes = [...plans.flatMap(part => part.changes), ...planOrder.changes, ...settings.flatMap(item => item.result.changes)]
    .filter(change => base || !same(change.local, change.remote))
  const unresolved = changes.filter(change => change.conflict && !choices[change.key])
  const list = (planOrder.value ?? keptPlans.map(plan => plan.id)).map(id => keptPlans.find(plan => plan.id === id)!)
  const parsed = workspaceSchema.safeParse({
    ...Object.fromEntries(settings.filter(item => item.result.value !== undefined).map(item => [item.key, item.result.value])),
    plans: list, activePlanId: list.some(plan => plan.id === local.activePlanId) ? local.activePlanId : list[0]?.id,
    ...(local.semester !== undefined ? { semester: local.semester } : {}), ...(local.tab !== undefined ? { tab: local.tab } : {}),
  })
  const selections = (workspace: PlanWorkspace) => workspace.plans.map(plan => ({ id: plan.id, courses: plan.courses, pending: plan.pendingAnnualChanges }))
  // ponytail: conservative across custom catalogs; narrow to affected course IDs only if this blocks real use.
  const coupled = base && ((!same(base.customCourses, local.customCourses) && !same(selections(base), selections(remote))) ||
    (!same(base.customCourses, remote.customCourses) && !same(selections(base), selections(local))))
  const reason = !base ? "אין עותק משותף קודם להשוואה בטוחה. מוצגים ההבדלים בין העותקים בלבד."
    : [base, local, remote].some(duplicateCourses) ? "קורס מופיע יותר מפעם אחת באותו סמסטר. יש לתקן את העותק לפני מיזוג."
    : coupled ? "שינוי בקורסים האישיים עשוי להשפיע על בחירות הקורסים בעותק השני. השתמשו בבחירת עותק מלא."
    : !parsed.success && !unresolved.length ? "התוצאה אינה מערכת תקינה (למשל, נמחקו כל המערכות). בחרו עותק מלא או שנו את הבחירות." : undefined
  return { changes, unresolved, reason, workspace: !reason && !unresolved.length && parsed.success ? parsed.data : undefined }
}

export const workspaceSummary = (workspace: PlanWorkspace) => workspace.plans.map(plan => ({
  id: plan.id, name: plan.name,
  semesters: Object.entries(plan.courses ?? {}).map(([semester, courses]) => ({ semester, count: courses.length })),
}))
