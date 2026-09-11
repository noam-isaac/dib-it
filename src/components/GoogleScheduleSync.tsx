import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core"
import { doc, onSnapshot, runTransaction } from "firebase/firestore"
import { useEffect, useRef, useState } from "react"
import { useAuthState } from "react-firebase-hooks/auth"
import { auth, firestore } from "../firebase"
import { useLocalStorage } from "../hooks"
import { getWorkspace, setWorkspace } from "../models"
import type { PlanWorkspace } from "../plans"
import { cloudScheduleData, readCloudSchedule, scheduleKey, startScheduleSync, type SyncStatus } from "../scheduleSync"
import { downloadBlob } from "../utilities"

const EnabledGoogleScheduleSync = () => {
  const [user] = useAuthState(auth!)
  const [automatic] = useLocalStorage<boolean>({ key: "Automatic Google Sync", defaultValue: false })
  const [status, setStatus] = useState<SyncStatus>("connecting")
  const [remote, setRemote] = useState<PlanWorkspace | null>(null)
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const controller = useRef<ReturnType<typeof startScheduleSync> | null>(null)

  useEffect(() => {
    setOpened(false)
    if (!user || !automatic) return
    setStatus("connecting")
    const uid = user.uid
    const reference = doc(firestore!, "users", uid)
    let listenerFailed = false
    let listenerTimer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    const sync = startScheduleSync({
      read: getWorkspace,
      apply: setWorkspace,
      base: () => {
        const saved = JSON.parse(localStorage.getItem("Dib It Sync") ?? "null")
        if (!saved) localStorage.setItem("Dib It Sync", JSON.stringify({ uid }))
        // Switching accounts requires a choice before uploading the previous account's schedules.
        return saved && saved.uid !== uid ? "different-account" : saved?.base
      },
      remember: base => localStorage.setItem("Dib It Sync", JSON.stringify({ uid, base })),
      exchange: decide => runTransaction(firestore!, async transaction => {
        const snapshot = await transaction.get(reference)
        if (auth!.currentUser?.uid !== uid) throw new Error("Account changed")
        const cloud = readCloudSchedule(snapshot.data())
        const upload = decide(cloud)
        if (upload) transaction.set(reference, cloudScheduleData(upload, uid))
        return cloud
      }),
      status: (next, cloud, failure) => {
        if (listenerFailed) return
        setStatus(next)
        if (next === "conflict") setRemote(cloud ?? null)
        if (failure) setError(failure instanceof Error ? failure.message : "נסו שוב מאוחר יותר.")
      },
    })
    controller.current = sync
    sync.schedule(0)
    const listen = () => {
      clearTimeout(listenerTimer)
      unsubscribe?.()
      unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          listenerFailed = false
          sync.schedule(0)
        }
      }, failure => {
        listenerFailed = true
        setError(failure.message)
        setStatus("error")
        listenerTimer = setTimeout(listen, 30000)
      })
    }
    listen()
    let localKey = scheduleKey(getWorkspace())
    const changed = (event: StorageEvent) => {
      if (event.key !== "Dib It" && event.key !== null) return
      const nextKey = scheduleKey(getWorkspace())
      if (nextKey !== localKey) { localKey = nextKey; sync.schedule() }
    }
    const resume = () => { if (listenerFailed) listen(); sync.schedule(0) }
    window.addEventListener("storage", changed)
    window.addEventListener("online", resume)
    window.addEventListener("focus", resume)
    return () => {
      sync.stop()
      clearTimeout(listenerTimer)
      unsubscribe?.()
      controller.current = null
      window.removeEventListener("storage", changed)
      window.removeEventListener("online", resume)
      window.removeEventListener("focus", resume)
    }
  }, [user?.uid, automatic, retry])

  if (!user || !automatic || (status !== "conflict" && status !== "error")) return null
  const download = (workspace: PlanWorkspace, name: string) =>
    downloadBlob(name, new Blob([JSON.stringify(workspace)], { type: "application/json" }))
  return (
    <div className="dont-print" dir="rtl" style={{ textAlign: "center", padding: 4 }}>
      <Text size="sm" role="status">{status === "conflict" ? "העותקים במכשיר ובגוגל שונים — בחרו איזה מהם לשמור." : "המערכות נשמרו במכשיר. הסנכרון לגוגל לא הושלם."}</Text>
      {status === "error" && <Text size="sm" dir="auto">{error}</Text>}
      {status === "conflict" && <Button size="compact-xs" variant="subtle" onClick={() => setOpened(true)}>בחירת המערכות לסנכרון</Button>}
      {status === "error" && <Button size="compact-xs" variant="subtle" title={error} onClick={() => setRetry(value => value + 1)}>ניסיון נוסף</Button>}
      <Modal opened={opened} onClose={() => setOpened(false)} title="בחירת המערכות לסנכרון" centered>
        <Stack dir="rtl">
          <Alert color="yellow">המערכות במכשיר ובגוגל שונות. הסנכרון ממתין לבחירתכם כדי לא לדרוס שינויים. הבחירה תחליף את כל המערכות בעותק השני ותסתנכרן למכשירים המחוברים.</Alert>
          <Text size="sm">אפשר להוריד את שני העותקים כגיבוי לפני הבחירה.</Text>
          <Group>
            <Button variant="default" onClick={() => download(getWorkspace(), "dibit-local-before-sync.json")}>הורדת העותק המקומי</Button>
            {remote && <Button variant="default" onClick={() => download(remote, "dibit-google-before-sync.json")}>הורדת העותק מגוגל</Button>}
          </Group>
          <Text>במכשיר: {getWorkspace().plans.map(plan => plan.name).join(", ")}</Text>
          <Text>בגוגל: {remote?.plans.map(plan => plan.name).join(", ") || "אין גיבוי"}</Text>
          <Button onClick={() => { controller.current?.resolve("upload", remote); setOpened(false) }}>החלפת גוגל במערכות מהמכשיר</Button>
          {remote && <Button onClick={() => { controller.current?.resolve("download", remote); setOpened(false) }}>החלפת המערכות במכשיר בעותק מגוגל</Button>}
        </Stack>
      </Modal>
    </div>
  )
}

const GoogleScheduleSync = () => auth && firestore ? <EnabledGoogleScheduleSync /> : null
export default GoogleScheduleSync
