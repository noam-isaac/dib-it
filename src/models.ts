import { useCallback, useSyncExternalStore } from "react"
import { storedWorkspaceSchema, type DibIt } from "./schemas"
import { getSemesterCatalogs, refreshAnnualData } from "./catalogData"
import { changeWorkspace, readWorkspaceRecord, WORKSPACE_KEY, LEGACY_KEY } from "./workspaceStore"
import { activePlanView, normalizePlans, updateActivePlan, reconcileActivePlan, PlanWorkspace } from "./plans"

export const prepareWorkspace = (workspace: DibIt | PlanWorkspace) => reconcileActivePlan(normalizePlans(storedWorkspaceSchema.parse(workspace)), getSemesterCatalogs())
export const reconcileCatalogs = () => changeWorkspace(prepareWorkspace)
export const refreshAnnualClassification = async () => {
  await refreshAnnualData()
  await reconcileCatalogs()
}

export const getWorkspace = () => readWorkspaceRecord().workspace
/** Explicit replacement boundary for restores, synchronization, and plan management. */
export const setWorkspace = (workspace: DibIt | PlanWorkspace) =>
  changeWorkspace(() => prepareWorkspace(workspace), true)
export const replaceWorkspace = (replacement: (workspace: PlanWorkspace) => DibIt | PlanWorkspace) => changeWorkspace(current => prepareWorkspace(replacement(current)), true)
export const updateWorkspace = (update: (workspace: PlanWorkspace) => PlanWorkspace) => changeWorkspace(current => prepareWorkspace(update(current)))
export const getDibIt = () => activePlanView(getWorkspace())
/** Explicit active-view replacement for legacy migration; UI edits use updateDibIt. */
export const setDibIt = (dibIt: DibIt) =>
  changeWorkspace(workspace => updateActivePlan(workspace, dibIt, getSemesterCatalogs()), true)
/** Apply a synchronous edit to the latest workspace, optionally bound to its originating plan. */
export const updateDibIt = (update: (current: DibIt) => DibIt, expectedPlanId?: string, editSemester?: string) => changeWorkspace(workspace => {
  if (expectedPlanId && workspace.activePlanId !== expectedPlanId) return workspace
  const current = activePlanView(workspace)
  const updated = update(current)
  if (updated === current) return workspace
  return updateActivePlan(workspace, storedWorkspaceSchema.parse(updated) as DibIt, getSemesterCatalogs(), editSemester)
})

const subscribeWorkspace = (changed: () => void) => {
  const listener = (event: StorageEvent) => { if (event.key === WORKSPACE_KEY || event.key === LEGACY_KEY || event.key === null) changed() }
  window.addEventListener("storage", listener)
  return () => window.removeEventListener("storage", listener)
}
// Subscribe to stable serialized bytes; schema validation happens at the read boundary.
const workspaceSnapshot = () => localStorage.getItem(WORKSPACE_KEY) ?? localStorage.getItem(LEGACY_KEY)
export const useWorkspace = () => {
  useSyncExternalStore(subscribeWorkspace, workspaceSnapshot)
  return getWorkspace()
}
export const useDibIt = () => {
  const workspace = useWorkspace()
  const view = activePlanView(workspace)
  const update = useCallback((change: (current: DibIt) => DibIt) =>
    updateDibIt(change, view.activePlanId, view.semester), [view.activePlanId, view.semester])
  return [view, update] as const
}

export type { DibIt, DibItCourse } from "./schemas"
