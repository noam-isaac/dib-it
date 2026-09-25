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
export const setWorkspace = (workspace: DibIt | PlanWorkspace) =>
  setLocalStorage("Dib It", reconcileActivePlan(normalizePlans(workspace), getSemesterCatalogs()), storedWorkspaceSchema)
export const getDibIt = () => activePlanView(getWorkspace())
export const setDibIt = (dibIt: DibIt) =>
  setLocalStorage("Dib It", updateActivePlan(getWorkspace(), dibIt, getSemesterCatalogs()), storedWorkspaceSchema)
export const useWorkspace = () => {
  const [stored] = useLocalStorage({ key: "Dib It", schema: storedWorkspaceSchema, defaultValue: {}, essential: true })
  return normalizePlans(stored)
}
export const useDibIt = () => {
  const workspace = useWorkspace()
  return [activePlanView(workspace), setDibIt] as const
}

export type { DibIt, DibItCourse } from "./schemas"
