import { useCallback } from "react"
import { storedWorkspaceSchema, type DibIt } from "./schemas"
import { getSemesterCatalogs, refreshAnnualData } from "./catalogData"
import { getLocalStorage, setLocalStorage, useLocalStorage } from "./hooks"
import { activePlanView, normalizePlans, updateActivePlan, reconcileActivePlan, PlanWorkspace } from "./plans"
import { rememberWorkspaceTime } from "./workspaceTime"
import { scheduleKey } from "./scheduleSync"

const saveWorkspace = (workspace: PlanWorkspace) => {
  const previous = (() => { try { return scheduleKey(getWorkspace()) } catch { return undefined } })()
  setLocalStorage("Dib It", workspace, storedWorkspaceSchema)
  if (previous !== scheduleKey(workspace)) rememberWorkspaceTime(workspace, Date.now(), "device")
}
export const prepareWorkspace = (workspace: DibIt | PlanWorkspace) => reconcileActivePlan(normalizePlans(workspace), getSemesterCatalogs())

export const reconcileCatalogs = () => {
  const workspace = getWorkspace()
  const updated = reconcileActivePlan(workspace, getSemesterCatalogs())
  if (JSON.stringify(updated) !== JSON.stringify(workspace)) saveWorkspace(updated)
}
export const refreshAnnualClassification = async () => {
  await refreshAnnualData()
  reconcileCatalogs()
}

export const getWorkspace = () => normalizePlans(getLocalStorage("Dib It", storedWorkspaceSchema, {}))
/** Explicit replacement boundary for restores, synchronization, and plan management. */
export const setWorkspace = (workspace: DibIt | PlanWorkspace) =>
  saveWorkspace(prepareWorkspace(workspace))
export const getDibIt = () => activePlanView(getWorkspace())
/** Explicit active-view replacement for legacy migration; UI edits use updateDibIt. */
export const setDibIt = (dibIt: DibIt) =>
  saveWorkspace(updateActivePlan(getWorkspace(), dibIt, getSemesterCatalogs()))
/** Apply a synchronous edit to the latest workspace, optionally bound to its originating plan. */
export const updateDibIt = (update: (current: DibIt) => DibIt, expectedPlanId?: string, editSemester?: string) => {
  const workspace = getWorkspace()
  if (expectedPlanId && workspace.activePlanId !== expectedPlanId) return
  const current = activePlanView(workspace)
  const updated = update(current)
  if (updated === current) return
  saveWorkspace(updateActivePlan(workspace, updated, getSemesterCatalogs(), editSemester))
}

export const useWorkspace = () => {
  const [stored] = useLocalStorage({ key: "Dib It", schema: storedWorkspaceSchema, defaultValue: {}, essential: true })
  return normalizePlans(stored)
}
export const useDibIt = () => {
  const workspace = useWorkspace()
  const view = activePlanView(workspace)
  const update = useCallback((change: (current: DibIt) => DibIt) =>
    updateDibIt(change, view.activePlanId, view.semester), [view.activePlanId, view.semester])
  return [view, update] as const
}

export type { DibIt, DibItCourse } from "./schemas"
