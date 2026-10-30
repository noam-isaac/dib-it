import { booleanSchema } from "../schemas"
import { Group, Menu, Text, Tooltip } from "@mantine/core"
import { notifications } from "@mantine/notifications"
import { useAuthState } from "react-firebase-hooks/auth"
import { useState } from "react"
import { auth, firestore } from "../firebase"
import { useLocalStorage } from "../hooks"
import { modals } from "@mantine/modals"
import { loadSyncReview } from "../googleWorkspace"
import { coordinationAvailable } from "../workspaceStore"
import ScheduleConflict from "./ScheduleConflict"

const EnabledGoogleSaveButtons = () => {
  const [currentUser] = useAuthState(auth!)
  const [busy, setBusy] = useState(false)
  const [automatic, setAutomatic] = useLocalStorage({ key: "Automatic Google Sync", schema: booleanSchema, defaultValue: false })
  if (!currentUser) return null

  const restore = async () => {
    setBusy(true)
    try {
      const review = await loadSyncReview(currentUser.uid)
      if (auth!.currentUser?.uid !== currentUser.uid) return
      if (!review.remote) {
        notifications.show({ title: "לא נמצא גיבוי בגוגל", message: "המערכות המקומיות נשארו כפי שהן.", color: "yellow" })
        return
      }
      modals.open({ title: "השוואה לפני שחזור מגוגל", size: "xl", centered: true,
        children: <ScheduleConflict uid={currentUser.uid} initial={review} initialChoice="download" onClose={() => modals.closeAll()} /> })
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
      const review = await loadSyncReview(currentUser.uid)
      if (auth!.currentUser?.uid !== currentUser.uid) return
      modals.open({ title: "השוואה לפני גיבוי בגוגל", size: "xl", centered: true,
        children: <ScheduleConflict uid={currentUser.uid} initial={review} initialChoice="upload" onClose={() => modals.closeAll()} /> })
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
        <Menu.Item disabled={!coordinationAvailable()} renderRoot={props => <button {...props} role="menuitemcheckbox" aria-checked={automatic} />} closeMenuOnClick={false}
          leftSection={<i className="fa-solid fa-cloud" aria-hidden="true" />}
          rightSection={
            // The state is spelled out as well as drawn: the switch alone read as decoration.
            <Group gap={6} wrap="nowrap" aria-hidden="true">
              <Text size="xs" fw={600} c={automatic ? "cyan" : "dimmed"}>{automatic ? "מופעל" : "כבוי"}</Text>
              <i className={`fa-solid fa-toggle-${automatic ? "on" : "off"}`}
                style={{ fontSize: 20, color: `var(--mantine-color-${automatic ? "cyan-6" : "dimmed"})` }} />
            </Group>
          }
          onClick={() => setAutomatic(!automatic)}>
          סנכרון אוטומטי עם גוגל
        </Menu.Item>
      </Tooltip>
      <Tooltip label="פעולה זו תחליף את כל מערכות השעות ששמורות בגוגל">
        <Menu.Item disabled={busy || !coordinationAvailable()} leftSection={<i className="fa-solid fa-save" aria-hidden="true" />} onClick={save}>
          גיבוי בגוגל
        </Menu.Item>
      </Tooltip>
      <Menu.Item disabled={busy || !coordinationAvailable()} leftSection={<i className="fa-solid fa-sync" aria-hidden="true" />} onClick={restore}>
        שחזור מגוגל
      </Menu.Item>
    </>
  )
}
const GoogleSaveButtons = () => auth && firestore ? <EnabledGoogleSaveButtons /> : null
export default GoogleSaveButtons
