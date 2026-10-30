import { WORKSPACE_KEY } from "../src/workspaceStore"

/** Unit-test-only serialized lock. Real cross-tab locking is exercised in the browser suite. */
export const withWorkspaceStorage = async <T>(initial: unknown, check: (storage: {
  raw: () => string | null; recordRaw: () => string | null; writes: () => number; events: () => number
  fail: () => void; recover: () => void; values: Map<string, string>
}) => T | Promise<T>) => {
  const keys = ["localStorage", "window", "StorageEvent", "navigator"] as const
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  const values = new Map<string, string>(initial === undefined ? [] : [["Dib It", JSON.stringify(initial)]])
  let writes = 0, events = 0, failed = false
  let queue: Promise<unknown> = Promise.resolve()
  class TestStorageEvent extends Event {
    readonly key: string
    constructor(type: string, init: { key: string }) { super(type); this.key = init.key }
  }
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failed) throw new Error("Quota exceeded")
        values.set(key, value); writes += 1
      },
      removeItem: (key: string) => values.delete(key),
    } },
    window: { configurable: true, value: { dispatchEvent: (event: Event) => { if (event.type === "storage") events += 1; return true } } },
    StorageEvent: { configurable: true, value: TestStorageEvent },
    navigator: { configurable: true, value: { locks: { request: <V>(_name: string, task: () => V) => {
      const next = queue.then(task)
      queue = next.catch(() => {})
      return next
    } } } },
  })
  try {
    return await check({
      raw: () => values.has(WORKSPACE_KEY) ? JSON.stringify((JSON.parse(values.get(WORKSPACE_KEY)!) as { workspace: unknown }).workspace) : values.get("Dib It") ?? null,
      recordRaw: () => values.get(WORKSPACE_KEY) ?? null,
      writes: () => writes, events: () => events, fail: () => { failed = true }, recover: () => { failed = false }, values,
    })
  } finally {
    await queue
    keys.forEach((key, index) => {
      const descriptor = descriptors[index]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
}
