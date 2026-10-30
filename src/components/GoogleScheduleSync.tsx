import { booleanSchema } from "../schemas"
import { Button, Modal, Text } from "@mantine/core"
import { onSnapshot } from "firebase/firestore"
import { useEffect, useState } from "react"
import { useAuthState } from "react-firebase-hooks/auth"
import { auth, firestore } from "../firebase"
import { useLocalStorage } from "../hooks"
import { scheduleKey, startScheduleSync, type SyncReview, type SyncStatus } from "../scheduleSync"
import { coordinationAvailable, readWorkspaceRecord, WORKSPACE_KEY } from "../workspaceStore"
import { googleReference, googleSyncOptions, loadSyncReview } from "../googleWorkspace"
import ScheduleConflict from "./ScheduleConflict"

const EnabledGoogleScheduleSync = () => {
  const [user] = useAuthState(auth!)
  const [automatic] = useLocalStorage({ key: "Automatic Google Sync", schema: booleanSchema, defaultValue: false })
  const [status, setStatus] = useState<SyncStatus>("connecting")
  const [review, setReview] = useState<SyncReview>()
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    setReview(undefined)
    if (!user || !automatic || !coordinationAvailable()) return
    setStatus("connecting")
    const uid = user.uid
    let listenerTimer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    let listenerFailed = false, stopped = false
    const sync = startScheduleSync(googleSyncOptions(uid, (next, _review, failure) => {
      if (listenerFailed) return
      setStatus(next)
      if (failure) setError(failure instanceof Error ? failure.message : "נסו שוב מאוחר יותר.")
    }))
    const listen = () => {
      if (stopped) return
      clearTimeout(listenerTimer); unsubscribe?.()
      unsubscribe = onSnapshot(googleReference(uid), { includeMetadataChanges: true }, snapshot => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          listenerFailed = false; sync.schedule(0)
        }
      }, failure => {
        listenerFailed = true; setError(failure.message); setStatus("error")
        listenerTimer = setTimeout(listen, 30000)
      })
    }
    sync.schedule(0); listen()
    let content = scheduleKey(readWorkspaceRecord().workspace)
    const changed = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_KEY && event.key !== null) return
      try {
        const next = scheduleKey(readWorkspaceRecord().workspace)
        if (next !== content) { content = next; sync.schedule() }
      } catch { setStatus("error"); setError("לא ניתן לקרוא את המערכות במכשיר. הורידו גיבוי לפני שחזור.") }
    }
    const resume = () => { if (listenerFailed) listen(); sync.schedule(0) }
    window.addEventListener("storage", changed)
    window.addEventListener("online", resume)
    window.addEventListener("focus", resume)
    return () => {
      stopped = true; sync.stop(); clearTimeout(listenerTimer); unsubscribe?.()
      window.removeEventListener("storage", changed)
      window.removeEventListener("online", resume)
      window.removeEventListener("focus", resume)
    }
  }, [user?.uid, automatic, retry])
  if (!user || !automatic || (!review && !["conflict", "error", "pending"].includes(status))) return null
  return <div className="dont-print" dir="rtl" style={{ textAlign: "center", padding: 4 }}>
    <Text size="sm" role="status">{status === "conflict" ? "העותקים במכשיר ובגוגל שונים — אפשר להשוות, למזג או לבחור עותק." : status === "pending" ? "השינויים הנוספים במכשיר נשמרו וממתינים לסנכרון." : status === "error" ? "הסנכרון לגוגל לא הושלם. הנתונים במכשיר נשמרו." : "השוואת העותקים שנפתחו לבדיקה — אפשר לרענן כדי לקבל את העדכון האחרון."}</Text>
    {status === "error" && <><Text size="sm" dir="auto">{error}</Text><Button size="compact-xs" variant="subtle" onClick={() => setRetry(value => value + 1)}>ניסיון נוסף</Button></>}
    <Button size="compact-xs" variant="subtle" onClick={async () => {
      try { setReview(await loadSyncReview(user.uid)) }
      catch (failure) { setError(failure instanceof Error ? failure.message : "לא ניתן לפתוח השוואה."); setStatus("error") }
    }}>השוואה ומיזוג מערכות</Button>
    <Modal opened={!!review} onClose={() => setReview(undefined)} title="השוואה ומיזוג מערכות" size="xl" centered>
      {review && <ScheduleConflict uid={user.uid} initial={review} onClose={() => { setReview(undefined); setRetry(value => value + 1) }} />}
    </Modal>
  </div>
}
const GoogleScheduleSync = () => auth && firestore ? <EnabledGoogleScheduleSync /> : null
export default GoogleScheduleSync
