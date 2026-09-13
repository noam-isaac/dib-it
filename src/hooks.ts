import { z } from "zod"
import { useEffect, useState } from "react"

/**
 * Read a stored value. A malformed non-essential value resets itself here rather than
 * throwing: one unreadable display preference must not take down the whole application.
 * Values holding user data pass `recoverable: false` so the failure still surfaces instead
 * of silently discarding a schedule.
 */
export const getLocalStorage = <T>(key: string, schema: z.ZodType<T>, defaultValue: T, recoverable = false) => {
  const stored = localStorage.getItem(key)
  if (stored === null) return defaultValue
  try {
    const value: unknown = JSON.parse(stored)
    return schema.parse(value)
  } catch (error) {
    if (!recoverable) throw error
    try { localStorage.removeItem(key) } catch { /* Nothing more to do if storage is locked. */ }
    return defaultValue
  }
}

export const setLocalStorage = <T>(
  key: string,
  value: T,
  schema: z.ZodType<T>
) => {
  const serialized = JSON.stringify(schema.parse(value))
  localStorage.setItem(key, serialized)
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue: serialized })
  )
}

interface LocalStorageOptions<T> {
  schema: z.ZodType<T>
  key: string
  defaultValue: T
  /** Set for keys holding user data, so corruption surfaces instead of resetting itself. */
  essential?: boolean
}

export const useLocalStorage = <T>({
  key,
  schema,
  defaultValue,
  essential,
}: LocalStorageOptions<T>) => {
  const [value, setValue] = useState<T>(() => getLocalStorage(key, schema, defaultValue, !essential))

  useEffect(() => {
    if (!localStorage.getItem(key) && defaultValue) {
      localStorage.setItem(key, JSON.stringify(defaultValue))
    }

    const listener = (e: StorageEvent) => {
      if (e.key === key) {
        // Use the same recovery/shape checks for cross-tab updates. A corrupt essential
        // value keeps the current in-memory workspace until reload can show recovery.
        try { setValue(getLocalStorage(key, schema, defaultValue, !essential)) }
        catch { /* Essential data must never reset from a storage event. */ }
      }
    }

    window.addEventListener("storage", listener)

    return () => window.removeEventListener("storage", listener)
  }, [key])

  const userSetValue = (newValue: T | ((previous: T) => T)) => {
    if (typeof newValue === "function") {
      newValue = (newValue as (previous: T) => T)(getLocalStorage(key, schema, defaultValue, !essential))
    }
    if (newValue !== undefined) {
      setLocalStorage(key, newValue, schema)
      setValue(newValue)
    }
  }

  return [value, userSetValue] as const
}

const fetchCaches = new WeakMap<object, Map<string, Promise<unknown>>>()
export const cachedFetch = <T>(url: string, schema: z.ZodType<T>, validate?: (value: unknown) => void): Promise<T> => {
  let cache = fetchCaches.get(schema)
  if (!cache) { cache = new Map(); fetchCaches.set(schema, cache) }
  let promise = cache.get(url)
  if (!promise) {
    promise = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`)
      const value: unknown = await response.json()
      return schema.parse(value)
    })
    cache.set(url, promise)
  }
  const currentCache = cache
  return (promise as Promise<T>).then(value => { validate?.(value); return value }).catch(error => {
    currentCache.delete(url)
    throw error
  })
}

export const useURLValue = <T>(url: string | null, schema: z.ZodType<T>, validate?: (value: unknown) => void): [Partial<T>, boolean, { failed: boolean; retry: () => void }] => {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    url: string; attempt: number; validate: typeof validate; schema: typeof schema; value: Partial<T>; failed: boolean
  }>()
  const current = !!url && result?.url === url && result.attempt === attempt && result.validate === validate && result.schema === schema

  useEffect(() => {
    if (!url) return
    let cancelled = false
    cachedFetch(url, schema, validate)
      .then(value => {
        if (!cancelled) setResult({ url, attempt, validate, schema, value, failed: false })
      })
      .catch(() => {
        if (!cancelled) setResult({ url, attempt, validate, schema, value: {}, failed: true })
      })
    return () => { cancelled = true }
  }, [url, attempt, validate, schema])

  return [current ? result.value : {}, !!url && !current, {
    failed: current && result.failed,
    retry: () => setAttempt(value => value + 1),
  }]
}
