import type { DibIt } from "./models"
import { annualChanges, applyAnnualChanges, reconcileAnnualCourses, type AnnualChange } from "./annualCourses"

type PlanData = Pick<DibIt, "courses" | "school" | "studyPlan" | "savedStudyPlans" | "degreeStartYear">
export interface SchedulePlan extends PlanData {
  id: string
  name: string
  pendingAnnualChanges?: AnnualChange[]
}
export interface PlanWorkspace extends Omit<DibIt, keyof PlanData | "activePlanId"> {
  plans: SchedulePlan[]
  activePlanId: string
}

/** Legacy schedules become the first plan without losing any semesters. */
export const normalizePlans = (data: DibIt | PlanWorkspace): PlanWorkspace => {
  if ("plans" in data) return data
  const { courses, school, studyPlan, savedStudyPlans, degreeStartYear, activePlanId: _, ...shared } = data
  return {
    ...shared,
    activePlanId: "default",
    plans: [{ id: "default", name: "מערכת השעות שלי", courses, school, studyPlan, savedStudyPlans, degreeStartYear }],
  }
}

export const activePlanView = (workspace: PlanWorkspace): DibIt => {
  const { plans, ...shared } = workspace
  const { id, name: _, pendingAnnualChanges: _pending, ...data } = plans.find(plan => plan.id === workspace.activePlanId)!
  return { ...shared, ...data, activePlanId: id }
}

export const updateActivePlan = (workspace: PlanWorkspace, view: DibIt, catalogs: Record<string, SemesterCourses> = {}): PlanWorkspace => {
  // A callback from a plan that was switched away from must not overwrite the new plan.
  if (view.activePlanId && view.activePlanId !== workspace.activePlanId) return workspace
  const { courses, school, studyPlan, savedStudyPlans, degreeStartYear, activePlanId: _, ...shared } = view
  const previous = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  const changes = annualChanges(previous.courses, view)
  return reconcileActivePlan({
    ...workspace,
    ...shared,
    plans: workspace.plans.map(plan => plan.id === workspace.activePlanId
      ? { ...plan, courses, school, studyPlan, savedStudyPlans, degreeStartYear,
          pendingAnnualChanges: [...plan.pendingAnnualChanges ?? [], ...changes] } : plan),
  }, catalogs)
}

export const reconcileActivePlan = (workspace: PlanWorkspace, catalogs: Record<string, SemesterCourses>): PlanWorkspace => {
  const plan = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  const view = activePlanView(workspace)
  const { courses, pending } = applyAnnualChanges(view, plan.pendingAnnualChanges ?? [], catalogs)
  const reconciled = reconcileAnnualCourses({ ...view, courses }, catalogs, pending)
  const { pendingAnnualChanges: _, ...rest } = plan
  return { ...workspace, plans: workspace.plans.map(item => item.id === plan.id
    ? { ...rest, courses: reconciled, ...(pending.length ? { pendingAnnualChanges: pending } : {}) } : item) }
}

export const addPlan = (workspace: PlanWorkspace, name: string, duplicate = false): PlanWorkspace => {
  if (!name.trim()) return workspace
  const source = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
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
  return { ...workspace, plans, activePlanId: workspace.activePlanId === id ? plans[0].id : workspace.activePlanId }
}

export const saveStudyPlan = (view: DibIt): DibIt => {
  const { school, studyPlan, savedStudyPlans = [] } = view
  if (!school || !studyPlan || savedStudyPlans.some(plan => plan.school === school && plan.studyPlan === studyPlan)) return view
  return { ...view, savedStudyPlans: [...savedStudyPlans, { school, studyPlan }] }
}
