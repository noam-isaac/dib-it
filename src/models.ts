import { useCallback } from "react"
import { storedWorkspaceSchema, type DibIt } from "./schemas"
import { getSemesterCatalogs, refreshAnnualData } from "./catalogData"
import { getLocalStorage, setLocalStorage, useLocalStorage } from "./hooks"
import { activePlanView, normalizePlans, updateActivePlan, reconcileActivePlan, PlanWorkspace } from "./plans"

export const reconcileCatalogs = () => {
  const workspace = getWorkspace()
  const updated = reconcileActivePlan(workspace, getSemesterCatalogs())
  if (JSON.stringify(updated) !== JSON.stringify(workspace)) setLocalStorage("Dib It", updated, storedWorkspaceSchema)
}
export const refreshAnnualClassification = async () => {
  await refreshAnnualData()
  reconcileCatalogs()
}

export const getWorkspace = () => normalizePlans(getLocalStorage("Dib It", storedWorkspaceSchema, {}))
/** Explicit replacement boundary for restores, synchronization, and plan management. */
export const setWorkspace = (workspace: DibIt | PlanWorkspace) =>
  setLocalStorage("Dib It", reconcileActivePlan(normalizePlans(workspace), getSemesterCatalogs()), storedWorkspaceSchema)
export const getDibIt = () => activePlanView(getWorkspace())
/** Explicit active-view replacement for legacy migration; UI edits use updateDibIt. */
export const setDibIt = (dibIt: DibIt) =>
  setLocalStorage("Dib It", updateActivePlan(getWorkspace(), dibIt, getSemesterCatalogs()), storedWorkspaceSchema)
/** Apply a synchronous edit to the latest workspace, optionally bound to its originating plan. */
export const updateDibIt = (update: (current: DibIt) => DibIt, expectedPlanId?: string, editSemester?: string) => {
  const workspace = getWorkspace()
  if (expectedPlanId && workspace.activePlanId !== expectedPlanId) return
  const current = activePlanView(workspace)
  const updated = update(current)
  if (updated === current) return
  setLocalStorage("Dib It", updateActivePlan(workspace, updated, getSemesterCatalogs(), editSemester), storedWorkspaceSchema)
}

export const useWorkspace = () => {
  const [stored] = useLocalStorage({ key: "Dib It", schema: storedWorkspaceSchema, defaultValue: {}, essential: true })
  return normalizePlans(stored)
}
export const useDibIt = () => {
  const workspace = useWorkspace()
  const update = useCallback((change: (current: DibIt) => DibIt) =>
    updateDibIt(change, workspace.activePlanId, workspace.semester), [workspace.activePlanId, workspace.semester])
  return [activePlanView(workspace), update] as const
}

export type { DibIt, DibItCourse } from "./schemas"
