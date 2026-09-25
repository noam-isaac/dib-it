import { dataUrls } from "./dataUrls"
import { cachedFetch } from "./hooks"
import { generalInfoSchema, semesterCoursesSchema } from "./schemas"
import { assertCourseCatalog, importSemesterCourses, type CatalogCourses } from "./catalog"
import { refreshAnnualFeed } from "./annualRegistry"

let catalogs: Record<string, CatalogCourses> = {}
let version = 0
let annualFeedFailed = false
const listeners = new Set<() => void>()
const changed = () => { version += 1; listeners.forEach(listener => listener()) }
export const subscribeCatalog = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const catalogVersion = () => version
export const getSemesterCatalogs = () => catalogs
export const hasAnnualFeedFailed = () => annualFeedFailed
export const cacheSemesterCourses = (semester: string, source: unknown) => {
  const imported = importSemesterCourses(semester, source)
  catalogs = { ...catalogs, [semester]: imported }
  changed()
  return imported
}
const startDateString = `date=${encodeURIComponent(new Date().toDateString())}`
export const loadSemesterCourses = async (semester: string) => {
  const source = await cachedFetch(`${dataUrls.semesterCourses(semester)}?${startDateString}`,
    semesterCoursesSchema, assertCourseCatalog)
  return cacheSemesterCourses(semester, source)
}
export const loadGeneralInfo = () => cachedFetch(dataUrls.info, generalInfoSchema)
export const refreshAnnualData = async () => {
  try {
    await refreshAnnualFeed()
    annualFeedFailed = false
  } catch (error) {
    annualFeedFailed = true
    throw error
  } finally { changed() }
}
