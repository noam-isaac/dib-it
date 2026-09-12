import { useEffect, useState } from "react"

/**
 * Read a stored value. A malformed non-essential value resets itself here rather than
 * throwing: one unreadable display preference must not take down the whole application.
 * Values holding user data pass `recoverable: false` so the failure still surfaces instead
 * of silently discarding a schedule.
 */
export const getLocalStorage = <T = any>(key: string, defaultValue = {}, recoverable = false) => {
  const stored = localStorage.getItem(key)
  if (stored === null) return defaultValue as T
  try {
    const value = JSON.parse(stored)
    if (recoverable && defaultValue != null && (typeof value !== typeof defaultValue ||
      Array.isArray(value) !== Array.isArray(defaultValue))) throw new Error("Invalid preference shape")
    return value as T
  } catch (error) {
    if (!recoverable) throw error
    try { localStorage.removeItem(key) } catch { /* Nothing more to do if storage is locked. */ }
    return defaultValue as T
  }
}

export const setLocalStorage = (
  key: string,
  value = {}
) => {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue: JSON.stringify(value) })
  )
}

interface LocalStorageOptions {
  key: string
  defaultValue?: any
  /** Set for keys holding user data, so corruption surfaces instead of resetting itself. */
  essential?: boolean
}

export const useLocalStorage = <T>({
  key,
  defaultValue,
  essential,
}: LocalStorageOptions) => {
  const [value, setValue] = useState<T>(() => getLocalStorage(key, defaultValue ?? null, !essential))

  useEffect(() => {
    if (!localStorage.getItem(key) && defaultValue) {
      localStorage.setItem(key, JSON.stringify(defaultValue))
    }

    const listener = (e: StorageEvent) => {
      if (e.key === key) {
        // Use the same recovery/shape checks for cross-tab updates. A corrupt essential
        // value keeps the current in-memory workspace until reload can show recovery.
        try { setValue(getLocalStorage(key, defaultValue ?? null, !essential)) }
        catch { /* Essential data must never reset from a storage event. */ }
      }
    }

    window.addEventListener("storage", listener)

    return () => window.removeEventListener("storage", listener)
  }, [key])

  const userSetValue = (newValue: any) => {
    if (typeof newValue === "function") {
      newValue = newValue(getLocalStorage(key, defaultValue ?? null, !essential))
    }
    if (newValue !== undefined) {
      setLocalStorage(key, newValue)
      setValue(newValue)
    }
  }

  return [value, userSetValue] as const
}

const cachedUrlValues: Record<string, any> = {}
const fetchUrlValuePromises: Record<string, Promise<any>> = {}

export const cachedFetch = async <T = any>(url: string, validate?: (value: unknown) => void): Promise<T> => {
  if (cachedUrlValues[url] === undefined && fetchUrlValuePromises[url] === undefined) {
    fetchUrlValuePromises[url] = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Catalog request failed: ${r.status}`)
      return r.json()
    })
  }

  try {
    const value = cachedUrlValues[url] ?? await fetchUrlValuePromises[url]
    validate?.(value)
    return cachedUrlValues[url] = value
  } catch (error) {
    delete cachedUrlValues[url]
    delete fetchUrlValuePromises[url]
    throw error
  }
}

export const useURLValue = <T>(url: string | null, validate?: (value: unknown) => void): [Partial<T>, boolean, { failed: boolean; retry: () => void }] => {
  const [value, setValue] = useState<Partial<T>>({})
  const [loading, setLoading] = useState(!!url)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setFailed(false)
    if (!url) { setValue({}); setLoading(false); return }
    let cancelled = false
    setValue({})
    setLoading(true)

    cachedFetch<T>(url, validate)
      .then((v) => {
        if (cancelled) return
        setValue(v)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setLoading(false); setFailed(true) } })
    return () => { cancelled = true }
  }, [url, attempt, validate])

  return [value, loading, { failed, retry: () => setAttempt(value => value + 1) }]
}
