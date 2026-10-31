import { useCallback, useEffect, useState } from "react"
import type { DibIt } from "./schemas"
import { getDefaultSemester, getSemesterCatalogs, refreshAnnualData, subscribeCatalog } from "./catalogData"
import { activePlanView, updateActivePlan, reconcileActivePlan, PlanWorkspace } from "./plans"
import { rememberWorkspaceTime } from "./workspaceTime"
import { scheduleKey } from "./scheduleSync"
import { readWorkspace, reportWorkspaceSaveError, writeWorkspace, type WorkspaceImportSource } from "./workspaceStorage"
import { decodeWorkspace } from "./workspaceFormat"

const saveWorkspace = (workspace: PlanWorkspace, source?: WorkspaceImportSource) => {
  const previous = (() => { try { return scheduleKey(getWorkspace()) } catch { return undefined } })()
  const saved = writeWorkspace(workspace, source)
  if (previous !== scheduleKey(saved)) rememberWorkspaceTime(saved, Date.now(), "device")
}
const attemptWorkspaceSave = (save: () => void) => {
  try {
    save()
  } catch (error) { reportWorkspaceSaveError(error); throw error }
}
export const prepareWorkspace = (workspace: DibIt | PlanWorkspace) => reconcileActivePlan(decodeWorkspace(workspace), getSemesterCatalogs())

export const reconcileCatalogs = () => attemptWorkspaceSave(() => {
  const workspace = getWorkspace()
  const updated = reconcileActivePlan(workspace, getSemesterCatalogs())
  if (JSON.stringify(updated) !== JSON.stringify(workspace)) saveWorkspace(updated)
})
export const refreshAnnualClassification = async () => {
  await refreshAnnualData()
  reconcileCatalogs()
}

export const getWorkspace = () => {
  const workspace = readWorkspace()
  const semester = workspace.semester || getDefaultSemester()
  // The initial display can use the current semester without rewriting saved data on opening.
  return semester === workspace.semester ? workspace : { ...workspace, semester }
}
/** Explicit replacement boundary for restores, synchronization, and plan management. */
export const setWorkspace = (workspace: DibIt | PlanWorkspace, source?: WorkspaceImportSource) =>
  attemptWorkspaceSave(() => saveWorkspace(prepareWorkspace(workspace), source))
export const getDibIt = () => activePlanView(getWorkspace())
/** Explicit active-view replacement for legacy migration; UI edits use updateDibIt. */
export const setDibIt = (dibIt: DibIt) =>
  attemptWorkspaceSave(() => saveWorkspace(updateActivePlan(getWorkspace(), dibIt, getSemesterCatalogs())))
/** Apply a synchronous edit to the latest workspace, optionally bound to its originating plan. */
export const updateDibIt = (update: (current: DibIt) => DibIt, expectedPlanId?: string, editSemester?: string) => attemptWorkspaceSave(() => {
  const workspace = getWorkspace()
  if (expectedPlanId && workspace.activePlanId !== expectedPlanId) return
  const current = activePlanView(workspace)
  const updated = update(current)
  if (updated === current) return
  saveWorkspace(updateActivePlan(workspace, updated, getSemesterCatalogs(), editSemester))
})

export const useWorkspace = () => {
  const [workspace, setWorkspace] = useState(getWorkspace)
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== "Dib It" && event.key !== null) return
      // Keep the last rendered copy on a corrupt/future update; every writer rechecks storage.
      try { setWorkspace(getWorkspace()) } catch (error) { reportWorkspaceSaveError(error) }
    }
    window.addEventListener("storage", changed)
    const unsubscribe = subscribeCatalog(() => {
      try { setWorkspace(getWorkspace()) } catch (error) { reportWorkspaceSaveError(error) }
    })
    return () => { window.removeEventListener("storage", changed); unsubscribe() }
  }, [])
  return workspace
}
export const useDibIt = () => {
  const workspace = useWorkspace()
  const view = activePlanView(workspace)
  const update = useCallback((change: (current: DibIt) => DibIt) =>
    updateDibIt(change, view.activePlanId, view.semester), [view.activePlanId, view.semester])
  return [view, update] as const
}

export type { DibIt, DibItCourse } from "./schemas"
