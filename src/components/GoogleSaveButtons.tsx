import { Menu } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { doc, getDoc } from "firebase/firestore"
import { useAuthState } from "react-firebase-hooks/auth"
import { useState } from "react"
import { auth, firestore } from "../firebase"
import { openScheduleRestore } from "./RestoreScheduleModal"

const EnabledGoogleSaveButtons = () => {
  const [currentUser] = useAuthState(auth!)
  const [busy, setBusy] = useState(false)
  if (!currentUser) return null

  const restore = async () => {
    setBusy(true)
    try {
      const snapshot = await getDoc(doc(firestore!, "users", currentUser.uid))
      if (auth!.currentUser?.uid !== currentUser.uid) return
      if (!snapshot.exists()) {
        notifications.show({ title: "לא נמצא גיבוי בגוגל", message: "המערכות המקומיות נשארו כפי שהן.", color: "yellow" })
        return
      }
      openScheduleRestore(snapshot.data(), "google")
    } catch (error) {
      notifications.show({
        title: "שגיאה בעדכון מגוגל",
        message: error instanceof Error ? error.message : "נסו שוב מאוחר יותר.",
        style: { direction: "rtl" },
        color: "red",
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Menu.Item disabled={busy} color="green" leftSection={<i className="fa-solid fa-sync" />} onClick={restore}>
      שחזור מגוגל
    </Menu.Item>
  )
}
const GoogleSaveButtons = () => auth && firestore ? <EnabledGoogleSaveButtons /> : null
export default GoogleSaveButtons
