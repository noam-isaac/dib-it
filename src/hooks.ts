import { useEffect, useState } from "react"

export const getLocalStorage = <T = any>(key: string, defaultValue = {}) => {
  return JSON.parse(
    localStorage.getItem(key) ?? JSON.stringify(defaultValue)
  ) as T
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
}

export const useLocalStorage = <T>({
  key,
  defaultValue,
}: LocalStorageOptions) => {
  const [value, setValue] = useState<T>(() => getLocalStorage(key, defaultValue ?? null))

  useEffect(() => {
    if (!localStorage.getItem(key) && defaultValue) {
      localStorage.setItem(key, JSON.stringify(defaultValue))
    }

    const listener = (e: StorageEvent) => {
      if (e.key === key) {
        if (e.newValue) {
          setValue(JSON.parse(e.newValue))
        } else {
          setValue(defaultValue ?? null)
        }
      }
    }

    window.addEventListener("storage", listener)

    return () => window.removeEventListener("storage", listener)
  }, [key])

  const userSetValue = (newValue: any) => {
    if (typeof newValue === "function") {
      newValue = newValue(getLocalStorage(key, defaultValue ?? null))
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

export const cachedFetch = async <T = any>(url: string): Promise<T> => {
  if (cachedUrlValues[url] !== undefined) {
    return cachedUrlValues[url]
  }

  if (fetchUrlValuePromises[url] === undefined) {
    fetchUrlValuePromises[url] = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Catalog request failed: ${r.status}`)
      return r.json()
    })
  }

  try {
    return cachedUrlValues[url] = await fetchUrlValuePromises[url]
  } catch (error) {
    delete fetchUrlValuePromises[url]
    throw error
  }
}

export const useURLValue = <T>(url: string | null): [Partial<T>, boolean, { failed: boolean; retry: () => void }] => {
  const [value, setValue] = useState<Partial<T>>((url ? cachedUrlValues[url] : undefined) ?? {})
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setFailed(false)
    if (!url) { setValue({}); setLoading(false); return }
    let cancelled = false
    setValue(cachedUrlValues[url] ?? {})
    if (cachedUrlValues[url] !== undefined) {
      setLoading(false)
      return
    }

    setLoading(true)

    cachedFetch<T>(url)
      .then((v) => {
        if (cancelled) return
        setValue(v)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setLoading(false); setFailed(true) } })
    return () => { cancelled = true }
  }, [url, attempt])

  return [value, loading, { failed, retry: () => setAttempt(value => value + 1) }]
}
