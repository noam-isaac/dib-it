import { Menu, Tooltip } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { useAuthState } from "react-firebase-hooks/auth"
import { useState } from "react"
import { auth, firestore } from "../firebase"
import { getDibIt, useDibIt } from "../models"
import { isScheduleBackup } from "../scheduleBackup"

const EnabledGoogleSaveButtons = () => {
  const [currentUser] = useAuthState(auth!)
  const [, setDibIt] = useDibIt()
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
        const latest = getDibIt()
        setDibIt({
          ...data,
          semester: latest.semester ?? data.semester,
          tab: latest.tab ?? data.tab,
        })
      } else {
        // This is a full backup: merge would retain deleted courses/semesters.
        await setDoc(reference, JSON.parse(JSON.stringify(getDibIt())))
      }
      notifications.show({
        title: restore ? "השחזור מגוגל הושלם" : "השמירה בגוגל הושלמה",
        message: restore
          ? "המערכות התעדכנו בהתאם לגיבוי שלכם."
          : "המערכות זמינות לשחזור במכשירים אחרים.",
        color: "green",
      })
    } catch (error) {
      notifications.show({
        title: restore ? "השחזור מגוגל נכשל" : "השמירה בגוגל נכשלה",
        message: error instanceof Error ? error.message : "נסו שוב מאוחר יותר.",
        color: "red",
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Tooltip label="פעולה זו תחליף את הגיבוי ששמור כרגע בגוגל.">
        <Menu.Item
          disabled={busy}
          color="green"
          leftSection={<i className="fa-solid fa-save" />}
          onClick={() => sync(false)}
        >
          גיבוי בגוגל
        </Menu.Item>
      </Tooltip>
      <Tooltip label="פעולה זו תחליף את המערכות המקומיות. מומלץ להוריד גיבוי קודם.">
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
