import { expect, test } from "bun:test"
import { cachedFetch } from "../src/hooks"
import { isCourseCatalog } from "../src/scheduleBackup"

const validate = (value: unknown) => {
  if (!isCourseCatalog(value)) throw new Error("Invalid catalog")
}

test("rejected HTTP-200 catalogs are refetched; accepted catalogs are shared and cached", async () => {
  const original = globalThis.fetch
  let requests = 0
  const catalog = { "12345678": { name: "Valid", groups: [] } }
  globalThis.fetch = (async () => {
    requests += 1
    return Response.json(requests === 1 ? { unrelated: { name: 123 } } : catalog)
  }) as typeof fetch
  try {
    const url = "https://test.invalid/validated-catalog"
    await expect(cachedFetch(url, validate)).rejects.toThrow("Invalid catalog")
    expect(await Promise.all([cachedFetch(url, validate), cachedFetch(url, validate)])).toEqual([catalog, catalog])
    expect(requests).toBe(2)
    expect(await cachedFetch(url, validate)).toEqual(catalog)
    expect(requests).toBe(2)
  } finally {
    globalThis.fetch = original
  }
})
