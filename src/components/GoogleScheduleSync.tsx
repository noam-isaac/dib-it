import { booleanSchema } from "../schemas"
import { Button, Modal, Text } from "@mantine/core"
import { onSnapshot } from "firebase/firestore"
import { useEffect, useState } from "react"
import { useAuthState } from "react-firebase-hooks/auth"
import { auth, firestore } from "../firebase"
import { useLocalStorage } from "../hooks"
import { scheduleKey, startScheduleSync, type SyncReview, type SyncStatus } from "../scheduleSync"
import { readLocalCopy } from "../localSchedule"
import { googleReference, googleSyncOptions, loadSyncReview } from "../googleWorkspace"
import ScheduleConflict from "./ScheduleConflict"

const EnabledGoogleScheduleSync = () => {
  const [user] = useAuthState(auth!)
  const [automatic, setAutomatic] = useLocalStorage({ key: "Automatic Google Sync", schema: booleanSchema, defaultValue: false })
  const [status, setStatus] = useState<SyncStatus>("connecting")
  const [review, setReview] = useState<SyncReview>()
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => { setReview(undefined); setStatus("connecting") }, [user?.uid])
  useEffect(() => {
    if (!user || !automatic) return
    setStatus("connecting")
    const uid = user.uid
    let listenerTimer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    let listenerFailed = false, stopped = false
    const sync = startScheduleSync(googleSyncOptions(uid, (next, comparison, failure) => {
      if (next === "conflict") {
        stopped = true; sync.stop(); clearTimeout(listenerTimer); unsubscribe?.()
        setStatus("conflict"); setReview(comparison); setError("")
        try { setAutomatic(false) }
        catch { setError("הסנכרון נעצר בלשונית זו, אך לא ניתן לשמור את הכיבוי בדפדפן. בדקו שוב לפני טעינה מחדש.") }
        return
      }
      if (listenerFailed) return
      setStatus(next)
      if (failure) setError(failure instanceof Error ? failure.message : "נסו שוב מאוחר יותר.")
    }, () => !stopped && localStorage.getItem("Automatic Google Sync") === "true"))
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
    let content = scheduleKey(readLocalCopy().workspace)
    const changed = (event: StorageEvent) => {
      if (event.key !== "Dib It" && event.key !== null) return
      try {
        const next = scheduleKey(readLocalCopy().workspace)
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
  if (!user || (!review && status !== "conflict" && !(automatic && ["error", "pending"].includes(status)))) return null
  return <div className="dont-print" dir="rtl" style={{ textAlign: "center", padding: 4 }}>
    <Text size="sm" role="status">{status === "conflict" ? "הסנכרון האוטומטי במכשיר הזה כובה בעקבות הבדלים בין העותקים. השוו את הקורסים והבחירות לפני הפעלה מחדש." : status === "pending" ? "השינויים הנוספים במכשיר נשמרו וממתינים לסנכרון." : status === "error" ? "הסנכרון לגוגל לא הושלם. הנתונים במכשיר נשמרו." : "השוואת העותקים שנפתחו לבדיקה — אפשר לרענן כדי לקבל את העדכון האחרון."}</Text>
    {error && ["error", "conflict"].includes(status) && <Text size="sm" dir="auto">{error}</Text>}
    {status === "error" && automatic && <Button size="compact-xs" variant="subtle" onClick={() => setRetry(value => value + 1)}>ניסיון נוסף</Button>}
    <Button size="compact-xs" variant="subtle" onClick={async () => {
      try { setReview(await loadSyncReview(user.uid)) }
      catch (failure) { setError(failure instanceof Error ? failure.message : "לא ניתן לפתוח השוואה."); setStatus("error") }
    }}>השוואה ומיזוג מערכות</Button>
    <Modal opened={!!review} onClose={() => setReview(undefined)} title="השוואה ומיזוג מערכות" size="xl" centered>
      {review && <ScheduleConflict uid={user.uid} initial={review} onClose={() => setReview(undefined)} />}
    </Modal>
  </div>
}
const GoogleScheduleSync = () => auth && firestore ? <EnabledGoogleScheduleSync /> : null
export default GoogleScheduleSync
