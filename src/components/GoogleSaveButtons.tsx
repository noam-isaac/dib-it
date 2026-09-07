import { Menu, Tooltip } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { useAuthState } from "react-firebase-hooks/auth"
import { useState } from "react"
import { auth, firestore } from "../firebase"
import { getWorkspace } from "../models"
import { openScheduleRestore } from "./RestoreScheduleModal"

const EnabledGoogleSaveButtons = () => {
  const [currentUser] = useAuthState(auth!)
  const [busy, setBusy] = useState(false)
  if (!currentUser) return null

  const sync = async (restore: boolean) => {
    setBusy(true)
    try {
      const reference = doc(firestore!, "users", currentUser.uid)
      if (restore) {
        const snapshot = await getDoc(reference)
        if (!snapshot.exists()) {
          notifications.show({
            title: "לא נמצא גיבוי בגוגל",
            message: "המערכות המקומיות נשארו כפי שהן.",
            color: "yellow",
          })
          return
        }
        const data: unknown = snapshot.data()
        openScheduleRestore(data, "google")
        return
      } else {
        // This is a full backup: merge would retain deleted courses/semesters.
        await setDoc(reference, JSON.parse(JSON.stringify(getWorkspace())))
      }
      notifications.show({
        title: "השמירה בגוגל בוצעה בהצלחה",
        message: "המערכות שלכם זמינות כעת להורדה במכשירים אחרים",
        style: { direction: "rtl" },
        icon: <i className="fa-solid fa-check" />,
        color: "green",
      })
    } catch (error) {
      notifications.show({
        title: restore ? "שגיאה בעדכון מגוגל" : "שגיאה בשמירה בגוגל",
        message: error instanceof Error ? error.message : "נסו שוב מאוחר יותר.",
        style: { direction: "rtl" },
        icon: <i className="fa-solid fa-exclamation" />,
        color: "red",
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Tooltip label="פעולה זו תדרוס את כל מה ששמור כרגע בגוגל!">
        <Menu.Item
          disabled={busy}
          color="green"
          leftSection={<i className="fa-solid fa-save" />}
          onClick={() => sync(false)}
        >
          גיבוי בגוגל
        </Menu.Item>
      </Tooltip>
      <Menu.Item
        disabled={busy}
        color="green"
        leftSection={<i className="fa-solid fa-sync" />}
        onClick={() => sync(true)}
      >
        שחזור מגוגל
      </Menu.Item>
    </>
  )
}
const GoogleSaveButtons = () =>
  auth && firestore ? <EnabledGoogleSaveButtons /> : null
export default GoogleSaveButtons
