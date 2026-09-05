import { describe, expect, test } from "bun:test"
import {
  collectExams,
  dateKey,
  filterExamDates,
  isCourseScheduled,
  parseDateString,
} from "../src/exams"

const info = {
  first: {
    groups: [{ group: "01" }],
    exams: [
      { date: "01/02/2026", moed: "א", hour: "09:00" },
      { date: "03/02/2026", moed: "ב" },
    ],
  },
  second: {
    groups: [{ group: "02" }],
    exams: [{ date: "02/02/2026", moed: "א" }],
  },
  third: {
    exams: [
      { date: "03/02/2026", moed: "א" },
      { date: "" },
      {},
      { date: "31/02/2026" },
    ],
  },
}
const exams = collectExams(
  [{ id: "first" }, { id: "second" }, { id: "third" }],
  info,
)

describe("scheduled course exams", () => {
  test("a sidebar course appears only with a currently valid selected group", () => {
    expect(isCourseScheduled({ id: "first" }, info.first)).toBe(false)
    expect(isCourseScheduled({ id: "first", groups: [] }, info.first)).toBe(
      false,
    )
    expect(
      isCourseScheduled({ id: "first", groups: ["stale"] }, info.first),
    ).toBe(false)
    expect(isCourseScheduled({ id: "first", groups: ["01"] }, info.first)).toBe(
      true,
    )
    expect(isCourseScheduled({ id: "missing", groups: ["01"] })).toBe(false)
  })
  test("catalog discovery includes unselected courses and every exam sitting", () => {
    expect(exams.map((exam) => exam.course.id)).toEqual([
      "first",
      "second",
      "first",
      "third",
    ])
  })
  test("duplicate source entries do not produce duplicate exams", () => {
    expect(collectExams([{ id: "first" }, { id: "first" }], info)).toHaveLength(
      2,
    )
  })
})

describe("calendar date filtering", () => {
  test("missing and impossible source dates are ignored", () => {
    for (const value of [
      undefined,
      "",
      "no date",
      "31/02/2026",
      "29/02/2025",
      "01/13/2026",
    ])
      expect(parseDateString(value)).toBeUndefined()
    expect(dateKey(parseDateString("29/02/2024")!)).toBe("2024-02-29")
    expect(parseDateString("01/02/2026")!.getHours()).toBe(0)
  })
  test("one date includes all matching courses, with or without a second endpoint", () => {
    expect(
      filterExamDates(exams, "2026-02-03", "").map((exam) => exam.course.id),
    ).toEqual(["first", "third"])
    expect(filterExamDates(exams, "2026-02-03", "2026-02-03")).toHaveLength(2)
  })
  test("ranges include both endpoints and accept reverse selection", () => {
    expect(filterExamDates(exams, "2026-02-01", "2026-02-03")).toHaveLength(4)
    expect(filterExamDates(exams, "2026-02-03", "2026-02-01")).toHaveLength(4)
    expect(filterExamDates(exams, "2026-02-01", "2026-02-02")).toHaveLength(2)
  })
  test("clear, empty-result and end-only filters", () => {
    expect(filterExamDates(exams, "", "")).toHaveLength(4)
    expect(filterExamDates(exams, "2026-05-01", "2026-05-09")).toHaveLength(0)
    expect(filterExamDates(exams, "", "2026-02-02")).toHaveLength(1)
  })
  test("dates are local calendar dates across DST and year boundaries", () => {
    const boundary = collectExams([{ id: "a" }], {
      a: {
        exams: [
          { date: "31/12/2025" },
          { date: "01/01/2026" },
          { date: "27/03/2026" },
        ],
      },
    })
    expect(filterExamDates(boundary, "2025-12-31", "2026-01-01")).toHaveLength(
      2,
    )
    expect(boundary[2].key).toBe("2026-03-27")
  })
})

test("calendar export excludes unselected and stale-group courses", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        semesters: {
          "2026a": { startDate: "2025-10-01", endDate: "2026-01-31" },
        },
      }),
    )) as typeof fetch
  try {
    const { getICS } = await import("../src/serialize")
    const result = await getICS(
      "2026a",
      [
        { id: "first", groups: ["01"] },
        { id: "second" },
        { id: "third", groups: ["missing"] },
      ],
      info,
    )
    expect(result.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(result).toContain("20260201")
    expect(result).not.toContain("20260202")
  } finally {
    globalThis.fetch = originalFetch
  }
})
