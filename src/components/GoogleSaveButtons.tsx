import { Group, Menu, Text, Tooltip } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { useAuthState } from "react-firebase-hooks/auth"
import { useState } from "react"
import { auth, firestore } from "../firebase"
import { getWorkspace } from "../models"
import { useLocalStorage } from "../hooks"
import { scheduleKey } from "../scheduleSync"
import { openScheduleRestore } from "./RestoreScheduleModal"

const EnabledGoogleSaveButtons = () => {
  const [currentUser] = useAuthState(auth!)
  const [busy, setBusy] = useState(false)
  const [automatic, setAutomatic] = useLocalStorage<boolean>({ key: "Automatic Google Sync", defaultValue: false })
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
  const save = async () => {
    setBusy(true)
    try {
      const workspace = getWorkspace()
      await setDoc(doc(firestore!, "users", currentUser.uid), JSON.parse(JSON.stringify(workspace)))
      if (auth!.currentUser?.uid !== currentUser.uid) return
      localStorage.setItem("Dib It Sync", JSON.stringify({ uid: currentUser.uid, base: scheduleKey(workspace) }))
      notifications.show({ title: "השמירה בגוגל בוצעה בהצלחה", message: "כל מערכות השעות נשמרו בגוגל.", color: "green" })
    } catch (error) {
      notifications.show({ title: "שגיאה בשמירה בגוגל", message: error instanceof Error ? error.message : "נסו שוב מאוחר יותר.", color: "red" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Tooltip label={automatic
        ? "כל שינוי במערכות נשמר בגוגל ומתעדכן במכשירים המחוברים. לחצו כדי לכבות."
        : "לחצו כדי להפעיל שמירה ועדכון אוטומטיים של המערכות בגוגל."}>
        <Menu.Item renderRoot={props => <button {...props} role="menuitemcheckbox" aria-checked={automatic} />} closeMenuOnClick={false}
          color={automatic ? "green" : undefined}
          leftSection={<i className="fa-solid fa-cloud" aria-hidden="true" />}
          rightSection={
            // The state is spelled out as well as drawn: the switch alone read as decoration.
            <Group gap={6} wrap="nowrap" aria-hidden="true">
              <Text size="xs" fw={600} c={automatic ? "green" : "dimmed"}>{automatic ? "מופעל" : "כבוי"}</Text>
              <i className={`fa-solid fa-toggle-${automatic ? "on" : "off"}`}
                style={{ fontSize: 20, color: `var(--mantine-color-${automatic ? "green-6" : "dimmed"})` }} />
            </Group>
          }
          onClick={() => setAutomatic(!automatic)}>
          סנכרון אוטומטי עם גוגל
        </Menu.Item>
      </Tooltip>
      <Tooltip label="פעולה זו תחליף את כל מערכות השעות ששמורות בגוגל">
        <Menu.Item disabled={busy} color="green" leftSection={<i className="fa-solid fa-save" aria-hidden="true" />} onClick={save}>
          גיבוי בגוגל
        </Menu.Item>
      </Tooltip>
      <Menu.Item disabled={busy} color="green" leftSection={<i className="fa-solid fa-sync" aria-hidden="true" />} onClick={restore}>
        שחזור מגוגל
      </Menu.Item>
    </>
  )
}
const GoogleSaveButtons = () => auth && firestore ? <EnabledGoogleSaveButtons /> : null
export default GoogleSaveButtons
