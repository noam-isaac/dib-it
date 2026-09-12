import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import { z } from "zod"
import {
  cachedFetch,
  getLocalStorage,
  setLocalStorage,
} from "../src/hooks"
import {
  biddingSchema,
  dibItSchema,
  generalInfoSchema,
  semesterCoursesSchema,
  type DibIt,
} from "../src/schemas"
import {
  getClosestValue,
  parseDateString,
} from "../src/utilities"
import autoBid, { getPossibleFaculties } from "../src/autoBid"
import { getICS } from "../src/serialize"

class TestStorage implements Storage {
  private values = new Map<string, string>()
  failWrites = false
  get length() {
    return this.values.size
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("Quota exceeded")
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  clear() {
    this.values.clear()
  }
}
const originalFetch = globalThis.fetch
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
)
let storage: TestStorage
beforeEach(() => {
  storage = new TestStorage()
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
})
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage)
  else Reflect.deleteProperty(globalThis, "localStorage")
})

test("invalid JSON and invalid saved shapes preserve their original bytes", () => {
  for (const raw of ["{broken", '{"courses":{"2026a":[{"id":42}]}}']) {
    storage.setItem("Dib It", raw)
    assert.throws(
      () => getLocalStorage("Dib It", dibItSchema, {}),
        )
    assert.equal(storage.getItem("Dib It"), raw)
  }
})

test("restore validation and failed writes leave the existing backup intact", () => {
  const state: DibIt = {
    semester: "2026a",
    courses: { "2026a": [{ id: "03661111" }] },
  }
  setLocalStorage("Dib It", state, dibItSchema, true)
  const saved = storage.getItem("Dib It")
  for (const input of [
    null,
    [],
    { unrelated: true },
    { courses: { "2026a": [{ id: 42 }] } },
  ]) {
    assert.throws(() =>
      setLocalStorage("Dib It", dibItSchema.parse(input), dibItSchema, true),
    )
    assert.equal(storage.getItem("Dib It"), saved)
  }
  storage.failWrites = true
  assert.throws(() => setLocalStorage("Dib It", {}, dibItSchema, true), /Quota/)
  assert.equal(storage.getItem("Dib It"), saved)
  assert.deepEqual(getLocalStorage("Dib It", dibItSchema, {}), state)
})

test("catalog schemas accept documented missing data but reject wrong types", () => {
  assert.ok(generalInfoSchema.safeParse({ semesters: { "2000a": {} } }).success)
  assert.ok(
    semesterCoursesSchema.safeParse({
      "03661111": { prerequisites: null, groups: [{ lecturer: null }] },
    }).success,
  )
  assert.equal(
    semesterCoursesSchema.safeParse({ "03661111": { groups: "wrong" } })
      .success,
    false,
  )
  const bidding = biddingSchema.parse({
    c: {
      s: {
        g: [
          {
            faculty: "",
            maximal: "",
            minimal: "",
            wanted: 1,
            received: 0,
            run_available: 1,
            total_available: 1,
          },
        ],
      },
    },
  })
  assert.equal(bidding.c?.s?.g?.[0]?.minimal, null)
})

test("custom course metadata survives validation and backup round trips", () => {
  const state = {
    customCourses: {
      "custom.json": {
        custom: {
          name: "Custom",
          credits: 4,
          groups: [{ group: "01", sourceNote: "keep" }],
        },
      },
    },
  }
  const parsed = dibItSchema.parse(state)
  setLocalStorage("Dib It", parsed, dibItSchema, true)
  assert.deepEqual(getLocalStorage("Dib It", dibItSchema, {}), state)
})

test("HTTP, JSON, and validation failures are retryable and never become cached successes", async () => {
  for (const [name, bad] of [
    ["http", () => new Response("unavailable", { status: 503 })],
    ["json", () => new Response("{")],
    ["schema", () => Response.json({ value: "wrong" })],
  ] as const) {
    let attempts = 0
    globalThis.fetch = async () =>
      ++attempts === 1 ? bad() : Response.json({ value: 7 })
    const schema = z.object({ value: z.number() })
    const url = `https://test.invalid/${name}`
    await assert.rejects(cachedFetch(url, schema))
    assert.deepEqual(await cachedFetch(url, schema), { value: 7 })
    assert.deepEqual(await cachedFetch(url, schema), { value: 7 })
    assert.equal(attempts, 2)
  }
})

test("concurrent requests share a fetch while each requested schema is enforced", async () => {
  let attempts = 0
  globalThis.fetch = async () => {
    attempts++
    return Response.json({ value: 4 })
  }
  const schema = z.object({ value: z.number() })
  const values = await Promise.all([
    cachedFetch("https://test.invalid/shared", schema),
    cachedFetch("https://test.invalid/shared", schema),
  ])
  assert.deepEqual(values, [{ value: 4 }, { value: 4 }])
  assert.equal(attempts, 1)
  await assert.rejects(
    cachedFetch("https://test.invalid/shared", z.object({ value: z.string() })),
  )
})


test("calendar recurrence ends at the semester end with a valid UTC timestamp", async () => {
  globalThis.fetch = async () => Response.json({
    semesters: {
      "2026a": { startDate: "2025-10-26", endDate: "2026-02-01" },
    },
  })
  const calendar = await getICS("2026a", [{ id: "c", groups: ["01"] }], {
    c: {
      name: "Test course",
      groups: [{
        group: "01",
        lessons: [{ day: "א", time: "09:00-11:00", type: "Lecture" }],
      }],
    },
  })
  assert.match(calendar, /\r\nRRULE:FREQ=WEEKLY;UNTIL=20260201T000000Z\r\n/)
  assert.equal((calendar.match(/BEGIN:VEVENT/g) ?? []).length, 1)
})

test("date parsing rejects impossible values; closest lookup handles empty inputs", () => {
  for (const value of [undefined, "", "31/02/2026", "wrong"])
    assert.equal(parseDateString(value), undefined)
  assert.equal(parseDateString("29/02/2024")?.getDate(), 29)
  assert.equal(getClosestValue(3, []), undefined)
  assert.equal(getClosestValue(3, [1, 4, 8]), 4)
  assert.equal(getClosestValue(20, [1, 4, 8]), 8)
})

test("bidding tolerates absent course statistics, missing winning bids, and empty faculty choices", async () => {
  const courses = [{ id: "c" }]
  const points = [{ faculty: "science", points: 100 }]
  assert.deepEqual(await getPossibleFaculties(courses, points, {}), {
    c: ["science"],
  })
  assert.deepEqual(await autoBid(courses, points, {}, {}), { science: {} })
  const data = biddingSchema.parse({
    c: {
      s: {
        g: [
          {
            faculty: "science",
            maximal: 20,
            minimal: 10,
            wanted: 1,
            received: 1,
            run_available: 1,
            total_available: 1,
          },
        ],
      },
    },
  })
  assert.deepEqual(await autoBid(courses, points, { c: ["science"] }, data), {
    science: { c: 100 },
  })
})
