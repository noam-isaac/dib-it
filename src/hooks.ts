import {
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react"
import { notifications } from "@mantine/notifications"
import { z } from "zod"

export const errorMessage = (error: unknown): string =>
  error instanceof z.ZodError
    ? "מבנה הנתונים אינו תקין. המידע הקיים לא הוחלף."
    : error instanceof Error
      ? error.message
      : "אירעה שגיאה. אנא נסו שוב."

export const getLocalStorage = <T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): T => {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  try {
    const input: unknown = JSON.parse(raw)
    return schema.parse(input)
  } catch {
    throw new Error(`המידע השמור ב־${key} אינו תקין. המקור נשמר.`)
  }
}

export const setLocalStorage = <T>(
  key: string,
  value: T,
  schema: z.ZodType<T>,
  quiet = false,
) => {
  const serialized = JSON.stringify(schema.parse(value))
  localStorage.setItem(key, serialized)
  if (!quiet)
    window.dispatchEvent(
      new StorageEvent("storage", { key, newValue: serialized }),
    )
}

const requests = new WeakMap<z.ZodType, Map<string, Promise<unknown>>>()

export const cachedFetch = <T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<T> => {
  let cache = requests.get(schema)
  if (!cache) {
    cache = new Map()
    requests.set(schema, cache)
  }
  const existing = cache.get(url)
  // This cache is keyed by the exact schema; only its validated output is stored.
  if (existing) return existing as Promise<T>
  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok)
        throw new Error(
          `טעינת הנתונים נכשלה (${response.status}). אנא נסו שוב.`,
        )
      const input: unknown = await response.json()
      return schema.parse(input)
    })
    .catch((error: unknown) => {
      cache.delete(url)
      throw error
    })
  cache.set(url, request)
  return request
}

export const reportError = (error: unknown) =>
  notifications.show({
    title: "לא ניתן להשלים את הפעולה",
    message: errorMessage(error),
    color: "red",
    style: { direction: "rtl" },
  })

export const useLocalStorage = <T>({
  key,
  schema,
  defaultValue,
}: {
  key: string
  schema: z.ZodType<T>
  defaultValue: T
}) => {
  const [value, setValue] = useState(() =>
    getLocalStorage(key, schema, defaultValue),
  )
  const current = useRef(value)
  const [error, setError] = useState<unknown>()

  useEffect(() => {
    const refresh = () => {
      try {
        const next = getLocalStorage(key, schema, defaultValue)
        current.current = next
        setValue(next)
        setError(undefined)
      } catch (error: unknown) {
        setError(error)
      }
    }
    refresh()
    const listener = (event: StorageEvent) => {
      if (event.key === key || event.key === null) refresh()
    }

    window.addEventListener("storage", listener)

    return () => window.removeEventListener("storage", listener)
    // Defaults are only read when the storage key changes.
  }, [key, schema])
  if (error) throw error
  const update = (action: SetStateAction<T>, quiet = false) => {
    const next =
      typeof action === "function"
        ? (action as (previous: T) => T)(current.current)
        : action
    // Persist before changing React state, so failed writes cannot look successful.
    try {
      setLocalStorage(key, next, schema, quiet)
      current.current = next
      setValue(next)
    } catch (error: unknown) {
      setError(error)
      throw error
    }
  }
  return [value, update] as const
}

export const useURLValue = <T>(url: string | undefined, schema: z.ZodType<T>, fallback: T): [T, boolean] => {
  const [value, setValue] = useState<T>(fallback)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    setValue(fallback)
    if (!url) return
    setLoading(true)
    void cachedFetch(url, schema)
      .then((result) => { if (active) setValue(result) })
      .catch((error: unknown) => { if (active) reportError(error) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [url, schema])

  return [value, loading]
}
