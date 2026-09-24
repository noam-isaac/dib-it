import { dataUrls } from "./dataUrls"
import { z } from "zod"
import { courseSchema } from "./schemas"

export const ANNUAL_FEED_URL = dataUrls.annual
const CACHE_KEY = "Annual Course Registry"
const courseId = z.string().regex(/^\d{8}$/)
const groupId = z.string().regex(/^\d{2}$/)
const verificationDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)
const examSnapshotSchema = z.object({
  verifiedAt: z.iso.datetime(),
  groups: z.record(groupId, courseSchema.shape.exams.unwrap()),
})
const annualYearSchema = z.object({
  source: z.literal("https://www.ims.tau.ac.il/Tal/KR/Search_P.aspx"),
  filter: z.literal("ckSem=0"),
  verifiedAt: verificationDate,
  groups: z.record(courseId, z.array(groupId).min(1)).refine(value => Object.keys(value).length > 0),
  exams: z.record(courseId, examSnapshotSchema).optional(),
  examFailures: z.record(courseId, z.iso.datetime()).optional(),
  classificationFailedAt: z.iso.datetime().optional(),
})
const annualFeedSchema = z.object({
  version: z.literal(1),
  classificationFailures: z.record(z.string().regex(/^\d{4}$/), z.iso.datetime()).optional(),
  years: z.record(z.string().regex(/^\d{4}$/), annualYearSchema).refine(value => Object.keys(value).length > 0),
})
export type AnnualYear = z.infer<typeof annualYearSchema>
type AnnualFeed = z.infer<typeof annualFeedSchema>
export const isAnnualFeed = (value: unknown): value is AnnualFeed => annualFeedSchema.safeParse(value).success

let years: Record<string, AnnualYear> = {}
/** Classification and each course's exams advance independently. Never re-date retained exams. */
export const acceptAnnualFeed = (value: unknown) => {
  const feed = annualFeedSchema.parse(value)
  years = { ...years, ...Object.fromEntries(Object.entries(feed.years).map(([year, incoming]) => {
    const previous = years[year]
    const classification = !previous || incoming.verifiedAt >= previous.verifiedAt ? incoming : previous
    const exams = Object.fromEntries([...new Set([...Object.keys(previous?.exams ?? {}), ...Object.keys(incoming.exams ?? {})])].map(id => {
      const before = previous?.exams?.[id], after = incoming.exams?.[id]
      return [id, after && (!before || after.verifiedAt >= before.verifiedAt) ? after : before!]
    }))
    const examFailures = Object.fromEntries([...new Set([...Object.keys(previous?.examFailures ?? {}), ...Object.keys(incoming.examFailures ?? {})])].flatMap(id => {
      const failedAt = [previous?.examFailures?.[id], incoming.examFailures?.[id]].filter((date): date is string => !!date).sort().slice(-1)[0]!
      return !exams[id] || failedAt > exams[id].verifiedAt ? [[id, failedAt]] : []
    }))
    return [year, { ...classification,
      ...(Object.keys(exams).length ? { exams } : {}),
      ...(previous?.examFailures || incoming.examFailures ? { examFailures } : {}),
    }]
  })) }
}
try {
  const cached = localStorage.getItem(CACHE_KEY)
  if (cached) acceptAnnualFeed(JSON.parse(cached) as unknown)
} catch { /* Without validated cached data, classification stays unknown until the feed arrives. */ }

export const annualYear = (year: string) => years[year]
export const refreshAnnualFeed = async () => {
  const response = await fetch(ANNUAL_FEED_URL, { cache: "no-cache", signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error("Annual-course feed unavailable")
  acceptAnnualFeed(await response.json())
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, years })) }
  catch { /* A full/disabled cache must not discard validated in-memory data. */ }
}
