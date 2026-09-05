import { Menu, Tooltip } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { useAuthState } from "react-firebase-hooks/auth"
import { useState } from "react"
import { auth, firestore } from "../firebase"
import { getWorkspace, setWorkspace } from "../models"
import { isScheduleBackup } from "../scheduleBackup"

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
        if (!isScheduleBackup(data))
          throw new Error("הגיבוי אינו בפורמט של מערכת Dib It.")
        const latest = getWorkspace()
        setWorkspace({
          ...data,
          semester: latest.semester ?? data.semester,
          tab: latest.tab ?? data.tab,
        })
      } else {
        // This is a full backup: merge would retain deleted courses/semesters.
        await setDoc(reference, JSON.parse(JSON.stringify(getWorkspace())))
      }
      notifications.show({
        title: restore ? "העדכון מגוגל בוצע בהצלחה" : "השמירה בגוגל בוצעה בהצלחה",
        message: restore
          ? "המערכות שלכם התעדכנו בהתאם למה ששמור במשתמש שלכם"
          : "המערכות שלכם זמינות כעת להורדה במכשירים אחרים",
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
      <Tooltip label="פעולה זו תדרוס את כל המערכות שלכם כרגע! מומלץ לגבות לפני כדי שתוכלו לשחזר.">
        <Menu.Item
          disabled={busy}
          color="green"
          leftSection={<i className="fa-solid fa-sync" />}
          onClick={() => sync(true)}
        >
          שחזור מגוגל
        </Menu.Item>
      </Tooltip>
    </>
  )
}
const GoogleSaveButtons = () =>
  auth && firestore ? <EnabledGoogleSaveButtons /> : null
export default GoogleSaveButtons
