import { expect, test } from "bun:test"
import { z } from "zod"
import { cachedFetch, getLocalStorage, setLocalStorage } from "../src/hooks"
import { biddingSchema, booleanSchema, storedWorkspaceSchema } from "../src/schemas"

test("stored workspace validation preserves recoverable bytes and nested user metadata", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  let raw = "{broken"
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => raw,
    setItem: (_key: string, value: string) => { raw = value },
    removeItem: () => { raw = "" },
  } })
  try {
    expect(() => getLocalStorage("Dib It", storedWorkspaceSchema, {})).toThrow()
    expect(raw).toBe("{broken")
    raw = JSON.stringify({ activePlanId: "first", plans: [{ id: "first", name: "Saved",
      courses: { "2026a": [{ id: "12345678", groups: ["01"] }] },
      savedStudyPlans: [{ school: "Faculty", studyPlan: "Program", note: "keep" }],
      pendingAnnualChanges: [{ semester: "2026a", id: "12345678", groups: null,
        changedGroups: ["01"], awaitingClassification: true, note: "keep" }],
    }], customCourses: { local: { custom: { name: "Custom", note: "keep",
      prerequisites: { parallel: null }, groups: [{ group: "01", note: "keep" }],
    } } } })
    expect(getLocalStorage("Dib It", storedWorkspaceSchema, {})).toEqual(JSON.parse(raw))
    const saved = raw
    expect(() => setLocalStorage("Dib It", { plans: [] }, storedWorkspaceSchema)).toThrow()
    expect(raw).toBe(saved)
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      setItem: () => { throw new Error("Quota exceeded") },
    } })
    expect(() => setLocalStorage("Dib It", {}, storedWorkspaceSchema)).toThrow("Quota exceeded")
    expect(raw).toBe(saved)
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: () => '"wrong preference type"', removeItem: () => { raw = "" },
    } })
    expect(getLocalStorage("Compact View", booleanSchema, false, true)).toBe(false)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})

test("failed fetches retry and caches enforce the requested schema", async () => {
  const original = globalThis.fetch
  try {
    for (const [name, failure] of [
      ["http", () => new Response("offline", { status: 503 })],
      ["json", () => new Response("{broken")],
      ["shape", () => Response.json({ value: "wrong" })],
    ] as const) {
      let attempts = 0
      globalThis.fetch = async () => ++attempts === 1 ? failure() : Response.json({ value: 7 })
      const schema = z.object({ value: z.number() })
      const url = `https://test.invalid/boundary-${name}`
      await expect(cachedFetch(url, schema)).rejects.toThrow()
      expect(await Promise.all([cachedFetch(url, schema), cachedFetch(url, schema)])).toEqual([{ value: 7 }, { value: 7 }])
      expect(attempts).toBe(2)
      await expect(cachedFetch(url, z.object({ value: z.string() }))).rejects.toThrow()
    }
  } finally { globalThis.fetch = original }
})

test("partial bidding statistics retain usable bids and reject malformed values", () => {
  const wrap = (row: unknown) => ({ c: { s: { g: [row] } } })
  expect(biddingSchema.parse(wrap({ faculty: "A", minimal: 10 }))).toEqual(wrap({ faculty: "A", minimal: 10 }))
  expect(biddingSchema.parse(wrap({ minimal: "" }))).toEqual(wrap({ minimal: null }))
  expect(biddingSchema.safeParse(wrap({ minimal: "bad" })).success).toBe(false)
})
