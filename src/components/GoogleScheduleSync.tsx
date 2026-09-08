import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core"
import { doc, onSnapshot, runTransaction } from "firebase/firestore"
import { useEffect, useRef, useState } from "react"
import { useAuthState } from "react-firebase-hooks/auth"
import { auth, firestore } from "../firebase"
import { getWorkspace, setWorkspace } from "../models"
import type { PlanWorkspace } from "../plans"
import { readCloudSchedule, startScheduleSync, type SyncStatus } from "../scheduleSync"
import { downloadBlob } from "../utilities"

const labels: Record<SyncStatus, string> = {
  connecting: "מתחבר לסנכרון…", syncing: "מסנכרן…", synced: "מסונכרן עם גוגל",
  conflict: "נדרשת בחירה לסנכרון", error: "נשמר במכשיר · הסנכרון ממתין",
}

const EnabledGoogleScheduleSync = () => {
  const [user] = useAuthState(auth!)
  const [status, setStatus] = useState<SyncStatus>("connecting")
  const [remote, setRemote] = useState<PlanWorkspace | null>(null)
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const controller = useRef<ReturnType<typeof startScheduleSync> | null>(null)

  useEffect(() => {
    setOpened(false)
    if (!user) return
    setStatus("connecting")
    const uid = user.uid
    const reference = doc(firestore!, "users", uid)
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
        if (upload) transaction.set(reference, JSON.parse(JSON.stringify(upload)))
        return cloud
      }),
      status: (next, cloud, failure) => {
        setStatus(next)
        if (next === "conflict") setRemote(cloud ?? null)
        if (failure) setError(failure instanceof Error ? failure.message : "נסו שוב מאוחר יותר.")
      },
    })
    controller.current = sync
    sync.schedule(0)
    const unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) sync.schedule(0)
    }, failure => { setError(failure.message); setStatus("error") })
    const changed = (event: StorageEvent) => { if (event.key === "Dib It" || event.key === null) sync.schedule() }
    const locallyChanged = () => sync.schedule()
    const resume = () => sync.schedule(0)
    window.addEventListener("storage", changed)
    window.addEventListener("dibit-workspace-changed", locallyChanged)
    window.addEventListener("online", resume)
    window.addEventListener("focus", resume)
    return () => {
      sync.stop()
      unsubscribe()
      controller.current = null
      window.removeEventListener("storage", changed)
      window.removeEventListener("dibit-workspace-changed", locallyChanged)
      window.removeEventListener("online", resume)
      window.removeEventListener("focus", resume)
    }
  }, [user?.uid, retry])

  if (!user) return null
  const download = (workspace: PlanWorkspace, name: string) =>
    downloadBlob(name, new Blob([JSON.stringify(workspace)], { type: "application/json" }))
  return (
    <div className="dont-print" dir="rtl" style={{ textAlign: "center", padding: 4 }}>
      <Text size="sm" role="status" aria-live="polite">{labels[status]}</Text>
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
