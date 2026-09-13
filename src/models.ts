import { storedWorkspaceSchema, type DibIt } from "./schemas"
import { importSemesterCourses, type CatalogCourses } from "./catalog"
import { getLocalStorage, setLocalStorage, useLocalStorage } from "./hooks"
import { activePlanView, normalizePlans, updateActivePlan, reconcileActivePlan, PlanWorkspace } from "./plans"

import { refreshAnnualFeed } from "./annualRegistry"

export const refreshAnnualClassification = async () => {
  await refreshAnnualFeed()
  setWorkspace(getWorkspace())
}

let semesterCatalogs: Record<string, CatalogCourses> = {}
export const cacheSemesterCourses = (semester: string, catalog: SemesterCourses) => {
  const imported = importSemesterCourses(semester, catalog)
  semesterCatalogs = { ...semesterCatalogs, [semester]: imported }
  const workspace = getWorkspace()
  if (workspace.semester?.slice(0, 4) !== semester.slice(0, 4)) return imported
  const updated = reconcileActivePlan(workspace, semesterCatalogs)
  if (JSON.stringify(updated) !== JSON.stringify(workspace)) setLocalStorage("Dib It", updated, storedWorkspaceSchema)
  return imported
}

export const getWorkspace = () => normalizePlans(getLocalStorage("Dib It", storedWorkspaceSchema, {}))
export const setWorkspace = (workspace: DibIt | PlanWorkspace) =>
  setLocalStorage("Dib It", reconcileActivePlan(normalizePlans(workspace), semesterCatalogs), storedWorkspaceSchema)
export const getDibIt = () => activePlanView(getWorkspace())
export const setDibIt = (dibIt: DibIt) =>
  setLocalStorage("Dib It", updateActivePlan(getWorkspace(), dibIt, semesterCatalogs), storedWorkspaceSchema)
export const useWorkspace = () => {
  const [stored] = useLocalStorage({ key: "Dib It", schema: storedWorkspaceSchema, defaultValue: {}, essential: true })
  return normalizePlans(stored)
}
export const useDibIt = () => {
  const workspace = useWorkspace()
  return [activePlanView(workspace), setDibIt] as const
}

export type { DibIt, DibItCourse } from "./schemas"
