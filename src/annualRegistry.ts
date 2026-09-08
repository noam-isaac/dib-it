import bundled from "./annualGroups.json"

export const ANNUAL_FEED_URL = "https://raw.githubusercontent.com/noam-isaac/dib-it/annual-data/annual-groups.json"
const CACHE_KEY = "Annual Course Registry"
const SOURCE = "https://www.ims.tau.ac.il/Tal/KR/Search_P.aspx"
type AnnualYear = { source: string; filter: string; verifiedAt: string; groups: Record<string, string[]> }
type AnnualFeed = { version: 1; years: Record<string, AnnualYear> }
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export const isAnnualFeed = (value: unknown): value is AnnualFeed =>
  record(value) && value.version === 1 && record(value.years) && Object.keys(value.years).length > 0 &&
  Object.entries(value.years).every(([year, data]) =>
    /^\d{4}$/.test(year) && record(data) && data.source === SOURCE && data.filter === "ckSem=0" &&
    typeof data.verifiedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.verifiedAt) &&
    Number.isFinite(Date.parse(data.verifiedAt)) && new Date(data.verifiedAt).toISOString().slice(0, 10) === data.verifiedAt &&
    record(data.groups) && Object.keys(data.groups).length > 0 && Object.entries(data.groups).every(([id, groups]) =>
      /^\d{8}$/.test(id) && Array.isArray(groups) && groups.length > 0 &&
      groups.every(group => typeof group === "string" && /^\d{2}$/.test(group))))

let years: Record<string, AnnualYear> = { ...bundled }
/** Preserve missing years and reject rollback; a refreshed year replaces its old classification. */
export const acceptAnnualFeed = (value: unknown) => {
  if (!isAnnualFeed(value)) throw new Error("Invalid annual-course feed")
  const updated = { ...years }
  for (const [year, data] of Object.entries(value.years)) {
    if (!updated[year] || data.verifiedAt >= updated[year].verifiedAt) updated[year] = data
  }
  years = updated
}
try {
  const cached = localStorage.getItem(CACHE_KEY)
  if (cached) acceptAnnualFeed(JSON.parse(cached))
} catch { /* Missing, corrupt, or unavailable cache: retain the bundled fallback. */ }

export const annualYear = (year: string) => years[year]
export const refreshAnnualFeed = async () => {
  const response = await fetch(ANNUAL_FEED_URL, { cache: "no-cache", signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error("Annual-course feed unavailable")
  acceptAnnualFeed(await response.json())
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, years })) }
  catch { /* A full/disabled cache must not discard validated in-memory data. */ }
}
