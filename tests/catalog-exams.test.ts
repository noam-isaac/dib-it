import { expect, test } from "bun:test"
import { acceptAnnualFeed, annualYear, isAnnualFeed, type AnnualYear } from "../src/annualRegistry"
import { importSemesterCourses, resolveCatalog } from "../src/catalog"
import { collectExams, courseExamSources, examDataWarnings } from "../src/exams"
import { createCalendar } from "../src/serialize"

const id = "21721600"
const first = { date: "27/06/2090", moed: "א", hour: "09:00", type: "בחינה סופית" }
const second = { ...first, date: "22/07/2090", moed: "ב" }
const verifiedAt = "2026-09-18T09:00:00Z"
const annual: AnnualYear = {
  source: "https://www.ims.tau.ac.il/Tal/KR/Search_P.aspx", filter: "ckSem=0", verifiedAt: "2026-09-18",
  groups: { [id]: ["01", "02"] },
  exams: { [id]: { verifiedAt, groups: { "01": [first], "02": [second] } } },
}
const raw = { [id]: { name: "צרפתית למתחילים", groups: ["01", "02", "03"].map(group => ({ group })), exams: [{ ...first, date: "26/06/2090" }] } }
const selected = [{ id, groups: ["01"] }]
const catalog = (data = annual, semester = "2090b") => resolveCatalog(semester, importSemesterCourses(semester, raw), data)

test("annual mid-year exams and retakes belong to A; finals belong to B across discovery and ICS", () => {
  const midyear = [{ ...first, date: "21/01/2090", type: "בחינת ביניים" }, { ...second, date: "21/03/2090", type: "בחינת ביניים" }]
  const data = { ...annual, exams: { [id]: { verifiedAt, groups: { "01": [...midyear, first], "02": [second] } } } }
  for (const semester of ["2090a", "2090b"]) {
    const info = catalog(data, semester)
    const expected = semester.endsWith("a") ? ["2090-01-21", "2090-03-21"] : ["2090-06-27"]
    expect(collectExams(selected, info).map(exam => exam.key)).toEqual(expected)
    expect(collectExams([{ id, groups: ["02"] }], info).map(exam => exam.key)).toEqual(semester.endsWith("a") ? [] : ["2090-07-22"])
    expect(collectExams([{ id }], info)).toEqual([])
    expect(collectExams([{ id }], info, "catalog").map(exam => exam.key)).toEqual([...expected, "2090-06-26", ...(semester.endsWith("b") ? ["2090-07-22"] : [])].sort())
    expect(raw[id].exams[0].date).toBe("26/06/2090")
    const ics = createCalendar(semester, selected, info, { startDate: "2089-10-01", endDate: "2089-10-31" })
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(expected.length)
    expected.forEach(key => expect(ics).toContain(key.replaceAll("-", "")))
    expect(ics).not.toContain(semester.endsWith("a") ? "20900627" : "20900121")
  }
})

test("authoritative snapshots replace changed dates and explicit cancellations; custom courses retain priority", () => {
  const changed: AnnualYear = { ...annual, exams: { [id]: { verifiedAt, groups: { "01": [{ ...first, date: "28/06/2090" }], "02": [] } } } }
  const info = catalog(changed)
  expect(collectExams(selected, info).map(exam => exam.key)).toEqual(["2090-06-28"])
  expect(collectExams([{ id, groups: ["02"] }], info)).toEqual([])
  expect(courseExamSources({ id, groups: ["02"] }, info[id])[0].status).toBe("ready")
  const custom = resolveCatalog("2090a", importSemesterCourses("2090a", raw), annual, { local: raw })
  expect(collectExams(selected, custom)[0].key).toBe("2090-06-26")
  expect(courseExamSources(selected[0], custom[id])[0].source).toBe("custom")
  expect(collectExams(selected, resolveCatalog("2089a", importSemesterCourses("2089a", raw)))[0].key).toBe("2090-06-26")
})

test("missing and failed annual data never become verified empty data or replace valid dates", () => {
  const { exams: _exams, ...unknown } = annual
  expect(collectExams(selected, catalog(unknown))).toEqual([])
  expect(courseExamSources(selected[0], catalog(unknown)[id])[0].status).toBe("unknown")
  expect(examDataWarnings([...selected, { id: "L1", groups: ["01"] }, { id: "L2", groups: ["01"] }], catalog(unknown))).toHaveLength(1)
  const stale = catalog({ ...annual, examFailures: { [id]: "2026-09-19T09:00:00Z" } })
  expect(collectExams(selected, stale)[0].key).toBe("2090-06-27")
  expect(courseExamSources(selected[0], stale[id])[0]).toMatchObject({ status: "stale", verifiedAt })
  const retained = catalog({ ...annual, exams: { [id]: { ...annual.exams![id]!, verifiedAt: "2000-01-01T00:00:00Z" } } })
  expect(examDataWarnings(selected, retained)).toEqual([])
})

test("classification and exam timestamps advance independently and reject rollback", () => {
  const feed = (data: AnnualYear) => ({ version: 1, years: { "2090": data } })
  acceptAnnualFeed(feed(annual))
  const { exams: _exams, ...legacy } = annual
  acceptAnnualFeed(feed({ ...legacy, verifiedAt: "2026-09-25" }))
  expect(annualYear("2090")!.exams![id]!.verifiedAt).toBe(verifiedAt)
  const next = "2026-09-26T09:00:00Z"
  acceptAnnualFeed(feed({ ...annual, exams: { [id]: { verifiedAt: next, groups: { "01": [], "02": [] } } } }))
  expect(annualYear("2090")!.verifiedAt).toBe("2026-09-25")
  expect(annualYear("2090")!.exams![id]!.groups["01"]).toEqual([])
  acceptAnnualFeed(feed(annual))
  expect(annualYear("2090")!.exams![id]!.verifiedAt).toBe(next)
  acceptAnnualFeed(feed({ ...annual, examFailures: { [id]: "2026-09-27T09:00:00Z" } }))
  expect(annualYear("2090")!.examFailures![id]).toBeDefined()
  acceptAnnualFeed(feed({ ...annual, exams: { [id]: { verifiedAt: "2026-09-28T09:00:00Z", groups: { "01": [first] } } } }))
  expect(annualYear("2090")!.examFailures).toEqual({})
  for (const exams of [null, { [id]: { groups: { "01": [] } } }, { [id]: { verifiedAt, groups: { bad: [] } } }, { [id]: { verifiedAt, groups: { "01": [{ date: 42 }] } } }]) {
    expect(isAnnualFeed({ version: 1, years: { "2090": { ...annual, exams } } })).toBe(false)
  }
})
