import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { annualYear } from "./annualRegistry"
import { resolveCatalog } from "./catalog"
import { catalogVersion, getSemesterCatalogs, hasAnnualFeedFailed, loadGeneralInfo, loadSemesterCourses, subscribeCatalog } from "./catalogData"
import { getDibIt, reconcileCatalogs, refreshAnnualClassification, setDibIt } from "./models"

/** Both the current semester and historical course details use the same loading boundary. */
export const useCatalog = (semester?: string, custom?: Record<string, SemesterCourses>, active = false) => {
  const version = useSyncExternalStore(subscribeCatalog, catalogVersion)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ semester: string; attempt: number; failed: boolean }>()
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!semester) {
        if (!active) return
        const info = await loadGeneralInfo()
        if (!info.currentSemester) throw new Error("Missing current semester")
        if (!cancelled) setDibIt({ ...getDibIt(), semester: info.currentSemester })
        return
      }
      await loadSemesterCourses(semester)
      if (cancelled) return
      setResult({ semester, attempt, failed: false })
      if (active) {
        reconcileCatalogs()
        const other = semester.slice(0, 4) + (semester.endsWith("a") ? "b" : "a")
        void loadSemesterCourses(other).then(() => { if (!cancelled) reconcileCatalogs() }).catch(() => {})
      }
    }
    void load().catch(() => { if (!cancelled) setResult({ semester: semester ?? "", attempt, failed: true }) })
    return () => { cancelled = true }
  }, [semester, attempt, active])
  useEffect(() => {
    if (active) void refreshAnnualClassification().catch(() => {})
  }, [active])
  const courses = useMemo(() => semester
    ? resolveCatalog(semester, getSemesterCatalogs()[semester] ?? {}, annualYear(semester.slice(0, 4)), custom, hasAnnualFeedFailed())
    : {}, [semester, custom, version])
  const current = result?.semester === (semester ?? "") && result.attempt === attempt
  return { courses, ready: current && !result.failed, failed: current && result.failed, retry: () => setAttempt(value => value + 1), attempt }
}
