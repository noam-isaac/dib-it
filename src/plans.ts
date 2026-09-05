import type { DibIt } from "./models"

type PlanData = Pick<DibIt, "courses" | "school" | "studyPlan" | "degreeStartYear">
export interface SchedulePlan extends PlanData {
  id: string
  name: string
}
export interface PlanWorkspace extends Omit<DibIt, keyof PlanData | "activePlanId"> {
  plans: SchedulePlan[]
  activePlanId: string
}

/** Legacy schedules become the first plan without losing any semesters. */
export const normalizePlans = (data: DibIt | PlanWorkspace): PlanWorkspace => {
  if ("plans" in data) return data
  const { courses, school, studyPlan, degreeStartYear, activePlanId: _, ...shared } = data
  return {
    ...shared,
    activePlanId: "default",
    plans: [{ id: "default", name: "התוכנית שלי", courses, school, studyPlan, degreeStartYear }],
  }
}

export const activePlanView = (workspace: PlanWorkspace): DibIt => {
  const { plans, ...shared } = workspace
  const { id, name: _, ...data } = plans.find(plan => plan.id === workspace.activePlanId)!
  return { ...shared, ...data, activePlanId: id }
}

export const updateActivePlan = (workspace: PlanWorkspace, view: DibIt): PlanWorkspace => {
  // A callback from a plan that was switched away from must not overwrite the new plan.
  if (view.activePlanId && view.activePlanId !== workspace.activePlanId) return workspace
  const { courses, school, studyPlan, degreeStartYear, activePlanId: _, ...shared } = view
  return {
    ...workspace,
    ...shared,
    plans: workspace.plans.map(plan => plan.id === workspace.activePlanId
      ? { ...plan, courses, school, studyPlan, degreeStartYear } : plan),
  }
}

export const addPlan = (workspace: PlanWorkspace, name: string, duplicate = false): PlanWorkspace => {
  if (!name.trim()) return workspace
  const source = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  const plan: SchedulePlan = {
    ...(duplicate ? structuredClone(source) : {
      courses: {}, school: source.school, studyPlan: source.studyPlan, degreeStartYear: source.degreeStartYear,
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
