import { booleanSchema } from "../schemas"
import { Button, Popover, Stack, Text } from "@mantine/core"
import { useEffect, useRef, useState } from "react"
import { useAuthState } from "react-firebase-hooks/auth"
import { auth, firestore } from "../firebase"
import { useLocalStorage } from "../hooks"
import {
  baseForAccount,
  scheduleKey,
  startScheduleSync,
  type SyncChoice,
  type SyncReview,
  type SyncStatus,
} from "../scheduleSync"
import type { MergeChoice } from "../scheduleMerge"
import { readLocalCopy } from "../localSchedule"
import { watchGoogleCopy, googleSyncOptions } from "../googleWorkspace"
import ScheduleConflict from "./ScheduleConflict"

const statusMessages: Record<SyncStatus, string> = {
  connecting: "ממתין לסנכרון",
  syncing: "ממתין לסנכרון",
  synced: "מעודכן בגוגל",
  conflict: "נדרשת בחירה",
  pending: "ממתין לסנכרון",
  error: "הסנכרון לא הושלם",
}
const statusButtonStyles = {
  root: { maxWidth: "100%", height: "auto", paddingBlock: 2 },
  label: { whiteSpace: "normal" as const, textAlign: "start" as const },
}

const EnabledGoogleScheduleSync = () => {
  const [user] = useAuthState(auth!)
  const [automatic] = useLocalStorage({
    key: "Automatic Google Sync",
    schema: booleanSchema,
    defaultValue: false,
  })
  const [status, setStatus] = useState<SyncStatus>("connecting")
  const [review, setReview] = useState<SyncReview>()
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState("")
  const controller = useRef<ReturnType<typeof startScheduleSync> | undefined>(
    undefined,
  )

  useEffect(() => {
    setOpened(false)
    setReview(undefined)
    setError("")
    if (!user || !automatic) return
    setStatus("connecting")
    const uid = user.uid
    let stopped = false
    let listenerFailed = false
    const sync = startScheduleSync(
      googleSyncOptions(
        uid,
        (next, comparison, failure) => {
          if (stopped) return
          if (next === "conflict" && comparison) setReview(comparison)
          if (next === "synced") {
            setReview(undefined)
            setOpened(false)
          }
          if (listenerFailed) return
          setStatus((previous) =>
            next === "syncing" && previous === "conflict" ? previous : next,
          )
          setError(failure instanceof Error ? failure.message : "")
        },
        () =>
          !stopped && localStorage.getItem("Automatic Google Sync") === "true",
      ),
    )
    controller.current = sync
    const unsubscribe = watchGoogleCopy(
      uid,
      () => {
        listenerFailed = false
        sync.schedule(0)
      },
      (failure) => {
        listenerFailed = true
        setError(failure.message)
        setStatus("error")
      },
    )
    sync.schedule(0)
    const initial = readLocalCopy()
    let content = scheduleKey(initial.workspace)
    let base = baseForAccount(initial, uid)
    const changed = (event: StorageEvent) => {
      if (
        event.key !== "Dib It" &&
        event.key !== "Dib It Sync" &&
        event.key !== null
      )
        return
      try {
        const local = readLocalCopy()
        const next = scheduleKey(local.workspace)
        const nextBase = baseForAccount(local, uid)
        if (next !== content || nextBase !== base) {
          content = next
          base = nextBase
          // A local edit is pending during the debounce too, before a request starts.
          setStatus((previous) =>
            previous === "conflict" || previous === "error"
              ? previous
              : "pending",
          )
          sync.schedule()
        }
      } catch {
        setStatus("error")
        setError("לא ניתן לקרוא את המערכות במכשיר.")
      }
    }
    const resume = () => sync.retry()
    window.addEventListener("storage", changed)
    window.addEventListener("online", resume)
    window.addEventListener("focus", resume)
    return () => {
      stopped = true
      controller.current = undefined
      sync.stop()
      unsubscribe()
      window.removeEventListener("storage", changed)
      window.removeEventListener("online", resume)
      window.removeEventListener("focus", resume)
    }
  }, [user?.uid, automatic])

  if (!user) return null
  const message = automatic ? statusMessages[status] : "הסנכרון כבוי"
  const resolve = (
    current: SyncReview,
    choices: Record<string, MergeChoice> | SyncChoice,
  ) => {
    if (typeof choices === "string")
      controller.current?.resolve(current, choices)
    else controller.current?.resolveChanges(current, choices)
    // Closing does not cancel the choice. The same controller retries it and
    // only asks again if fresh contents contain an unanswered decision.
    setOpened(false)
    setStatus("syncing")
  }

  return (
    <div
      className="dont-print"
      dir="rtl"
      role="status"
      style={{ textAlign: "start" }}
    >
      {automatic && status === "error" ? (
        <Popover width={280} position="bottom" withArrow shadow="md">
          <Popover.Target>
            <Button
              size="compact-xs"
              variant="subtle"
              color="orange"
              styles={statusButtonStyles}
            >
              {message}
            </Button>
          </Popover.Target>
          <Popover.Dropdown dir="rtl">
            <Stack gap="xs">
              <Text size="sm">
                העדכונים עדיין לא סונכרנו. אפשר להמשיך לעבוד במכשיר.
              </Text>
              {error && (
                <Text size="sm" dir="auto">
                  {error}
                </Text>
              )}
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => controller.current?.retry()}
              >
                ניסיון נוסף
              </Button>
            </Stack>
          </Popover.Dropdown>
        </Popover>
      ) : automatic && status === "conflict" && review ? (
        <Button
          size="compact-xs"
          variant="subtle"
          color="orange"
          styles={statusButtonStyles}
          aria-label="בחירת השינויים לשמירה"
          onClick={() => setOpened(true)}
        >
          {message}
        </Button>
      ) : (
        <Text size="xs">{message}</Text>
      )}
      {automatic && opened && review && (
        <ScheduleConflict
          key={user.uid}
          uid={user.uid}
          review={review}
          onResolve={resolve}
          onClose={() => setOpened(false)}
        />
      )}
    </div>
  )
}

const GoogleScheduleSync = () =>
  auth && firestore ? <EnabledGoogleScheduleSync /> : null
export default GoogleScheduleSync
