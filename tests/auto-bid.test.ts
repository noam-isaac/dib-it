import { expect, test } from "bun:test"
import autoBid from "../src/autoBid"

test("bidding respects allowed faculties and balances large costs without crashing or dropping points", async () => {
  const courses = [{ id: "one" }, { id: "two" }]
  const points = [{ faculty: "A", points: 100 }, { faculty: "B", points: 200 }]
  const bidding = Object.fromEntries(courses.map(({ id }) => [id, { "2025a": { "01": [
    { faculty: "A", minimal: 1000000 }, { faculty: "B", minimal: 2000000 },
  ] } }])) as AllTimeBiddingInfo
  const result = await autoBid(courses, points, { one: ["B"], two: ["A", "B"] }, bidding)
  expect(result.A.one).toBeUndefined()
  expect(result.B.one).toBeGreaterThanOrEqual(0)
  for (const faculty of ["A", "B"]) {
    const bids = Object.values(result[faculty])
    expect(bids.every(value => Number.isInteger(value) && value >= 0)).toBe(true)
    if (bids.length) expect(bids.reduce((a, b) => a + b, 0)).toBe(points.find(p => p.faculty === faculty)!.points)
  }
  expect(await autoBid([{ id: "one" }], points, { one: [] }, bidding)).toEqual({ A: {}, B: {} })
  expect(await autoBid([{ id: "unknown" }], points, {}, {})).toEqual({ A: {}, B: {} })
})
