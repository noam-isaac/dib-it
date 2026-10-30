import type { CatalogCourses } from "./catalog"
import type { DibIt } from "./models"
import { annualChanges, applyAnnualChanges, reconcileAnnualCourses } from "./annualCourses"

import { z } from "zod"
import { schedulePlanSchema, workspaceSchema } from "./schemas"
import { decodeWorkspace, navigationFields, planFields, sharedFields } from "./workspaceFormat"
export type SchedulePlan = Pick<z.infer<typeof schedulePlanSchema>, keyof typeof schedulePlanSchema.shape>
export type PlanWorkspace = Pick<z.infer<typeof workspaceSchema>, keyof typeof workspaceSchema.shape>

/** All historical layouts use the same versioned, side-effect-free decoder. */
export const normalizePlans = (data: DibIt | PlanWorkspace): PlanWorkspace => decodeWorkspace(data)

export const activePlanView = (workspace: PlanWorkspace): DibIt => {
  const plan = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  const pick = (source: object, fields: readonly string[]) => Object.fromEntries(Object.entries(source).filter(([key]) => fields.includes(key)))
  return { ...pick(workspace, [...navigationFields, ...sharedFields]), ...pick(plan, planFields), activePlanId: plan.id }
}

export const updateActivePlan = (workspace: PlanWorkspace, view: DibIt, catalogs: Record<string, CatalogCourses> = {}, editSemester = view.semester): PlanWorkspace => {
  // A callback from a plan that was switched away from must not overwrite the new plan.
  if (view.activePlanId && view.activePlanId !== workspace.activePlanId) return workspace
  const shared = Object.fromEntries(Object.entries(view).filter(([key]) => [...navigationFields, ...sharedFields].includes(key as typeof navigationFields[number] | typeof sharedFields[number])))
  const data = Object.fromEntries(planFields.map(key => [key, view[key]]))
  const previous = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  // A stale control can edit its rendered semester while navigation has moved on.
  const changes = annualChanges(previous.courses, { ...view, semester: editSemester })
  const pendingAnnualChanges = [...previous.pendingAnnualChanges ?? [], ...changes]
  return reconcileActivePlan({
    ...workspace,
    ...shared,
    plans: workspace.plans.map(plan => plan.id === workspace.activePlanId
      ? { ...plan, ...data, ...(pendingAnnualChanges.length ? { pendingAnnualChanges } : {}) } : plan),
  }, catalogs)
}

export const reconcileActivePlan = (workspace: PlanWorkspace, catalogs: Record<string, CatalogCourses>): PlanWorkspace => {
  const plan = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  const view = activePlanView(workspace)
  const { courses, pending } = applyAnnualChanges(view, plan.pendingAnnualChanges ?? [], catalogs)
  const reconciled = reconcileAnnualCourses({ ...view, courses }, catalogs, pending)
  if (JSON.stringify(plan.courses ?? {}) === JSON.stringify(reconciled) &&
    JSON.stringify(plan.pendingAnnualChanges ?? []) === JSON.stringify(pending)) return workspace
  const { pendingAnnualChanges: _, ...rest } = plan
  return { ...workspace, plans: workspace.plans.map(item => item.id === plan.id
    ? { ...rest, courses: reconciled, ...(pending.length ? { pendingAnnualChanges: pending } : {}) } : item) }
}

export const addPlan = (workspace: PlanWorkspace, name: string, duplicate = false, sourcePlanId = workspace.activePlanId): PlanWorkspace => {
  if (!name.trim()) return workspace
  const source = workspace.plans.find(plan => plan.id === sourcePlanId)
  if (!source) throw new Error("מערכת השעות שממנה נפתחה הפעולה כבר אינה קיימת. פתחו מחדש את בחירת המערכות.")
  const plan: SchedulePlan = {
    ...(duplicate ? structuredClone(source) : {
      courses: {}, school: source.school, studyPlan: source.studyPlan,
      savedStudyPlans: structuredClone(source.savedStudyPlans), degreeStartYear: source.degreeStartYear,
    }),
    id: crypto.randomUUID(),
    name: name.trim(),
  }
  return { ...workspace, plans: [...workspace.plans, plan], activePlanId: plan.id }
}

export const renamePlan = (workspace: PlanWorkspace, id: string, name: string): PlanWorkspace =>
  !name.trim() ? workspace : {
    ...workspace,
    plans: workspace.plans.map(plan => plan.id === id ? { ...plan, name: name.trim() } : plan),
  }

export const deletePlan = (workspace: PlanWorkspace, id: string): PlanWorkspace => {
  if (workspace.plans.length <= 1) return workspace
  const plans = workspace.plans.filter(plan => plan.id !== id)
  return { ...workspace, plans, activePlanId: workspace.activePlanId === id ? plans[0]!.id : workspace.activePlanId }
}

export const saveStudyPlan = (view: DibIt): DibIt => {
  const { school, studyPlan, savedStudyPlans = [] } = view
  if (!school || !studyPlan || savedStudyPlans.some(plan => plan.school === school && plan.studyPlan === studyPlan)) return view
  return { ...view, savedStudyPlans: [...savedStudyPlans, { school, studyPlan }] }
}
