import { expect, spyOn, test } from "bun:test"
import { semesterCoursesSchema } from "../src/schemas"
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
    await expect(cachedFetch(url, semesterCoursesSchema, validate)).rejects.toThrow()
    expect(await Promise.all([cachedFetch(url, semesterCoursesSchema, validate), cachedFetch(url, semesterCoursesSchema, validate)])).toEqual([catalog, catalog])
    expect(requests).toBe(2)
    expect(await cachedFetch(url, semesterCoursesSchema, validate)).toEqual(catalog)
    expect(requests).toBe(2)
  } finally {
    globalThis.fetch = original
  }
})

test("a shared 15-second deadline rejects stalled headers or JSON and allows a fresh retry", async () => {
  const original = globalThis.fetch
  const deadlines: (() => void)[] = []
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation((handler, milliseconds) => {
    expect(milliseconds).toBe(15000)
    deadlines.push(handler as () => void)
    return deadlines.length as unknown as ReturnType<typeof setTimeout>
  })
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation(() => {})
  const catalog = { "12345678": { name: "Valid", groups: [] } }
  try {
    for (const phase of ["headers", "json"] as const) {
      let requests = 0
      let requestSignal: AbortSignal | undefined
      let readingBody = () => {}
      const bodyStarted = new Promise<void>(resolve => { readingBody = resolve })
      globalThis.fetch = (async (_url, options) => {
        requests += 1
        if (requests > 1) return Response.json(catalog)
        const signal = options!.signal!
        requestSignal = signal
        if (phase === "headers") return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
        const response = new Response(new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('{"unfinished":'))
            signal.addEventListener("abort", () => stream.error(signal.reason), { once: true })
          },
        }))
        const json = response.json.bind(response)
        response.json = () => { readingBody(); return json() }
        return response
      }) as typeof fetch
      const url = `https://test.invalid/stalled-${phase}`
      const consumers = Promise.allSettled([
        cachedFetch(url, semesterCoursesSchema),
        cachedFetch(url, semesterCoursesSchema),
      ])
      if (phase === "json") await bodyStarted
      expect(requests).toBe(1)
      deadlines.at(-1)!()
      const failure = requestSignal!.reason
      expect(await consumers).toEqual([
        { status: "rejected", reason: failure }, { status: "rejected", reason: failure },
      ])
      expect(await cachedFetch(url, semesterCoursesSchema)).toEqual(catalog)
      expect(await cachedFetch(url, semesterCoursesSchema)).toEqual(catalog)
      expect(requests).toBe(2)
    }
    expect(clear).toHaveBeenCalledTimes(4)
  } finally {
    timeout.mockRestore()
    clear.mockRestore()
    globalThis.fetch = original
  }
})

test("requests work without AbortSignal.timeout", async () => {
  const original = globalThis.fetch
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")!
  const catalog = { "12345678": { name: "Valid", groups: [] } }
  Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true })
  globalThis.fetch = (async () => Response.json(catalog)) as typeof fetch
  try {
    expect(await cachedFetch("https://test.invalid/no-timeout-api", semesterCoursesSchema)).toEqual(catalog)
  } finally {
    Object.defineProperty(AbortSignal, "timeout", descriptor)
    globalThis.fetch = original
  }
})
