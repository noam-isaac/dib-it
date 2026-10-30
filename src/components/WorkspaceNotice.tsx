import { Alert, Button, Group, Text } from "@mantine/core"
import { useEffect, useState } from "react"
import { acknowledgeLegacy, coordinationAvailable, LEGACY_KEY, readWorkspaceRecord, WORKSPACE_KEY } from "../workspaceStore"
import { useWorkspace } from "../models"
import { downloadBlob } from "../utilities"
import { openScheduleRestore } from "./RestoreScheduleModal"

export default function WorkspaceNotice() {
  useWorkspace()
  const [failure, setFailure] = useState("")
  const [legacy, setLegacy] = useState(() => localStorage.getItem(LEGACY_KEY))
  useEffect(() => {
    const error = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail
      setFailure(value instanceof Error ? value.message : "לא ניתן לשמור. הנתונים האחרונים שנשמרו עדיין זמינים.")
    }
    const changed = (event: StorageEvent) => {
      setLegacy(localStorage.getItem(LEGACY_KEY))
      if (event.key === WORKSPACE_KEY) setFailure("")
    }
    window.addEventListener("workspace-error", error)
    window.addEventListener("storage", changed)
    return () => { window.removeEventListener("workspace-error", error); window.removeEventListener("storage", changed) }
  }, [])
  const oldChanged = legacy !== readWorkspaceRecord().legacy
  if (!failure && !oldChanged && coordinationAvailable()) return null
  return <Alert className="dont-print" color="yellow" dir="rtl" style={{ width: "min(100%, 800px)" }}>
    {!coordinationAvailable() && <Text>מצב צפייה בלבד: הדפדפן אינו תומך בשמירה מתואמת. אפשר להוריד גיבוי ולפתוח אותו בדפדפן עדכני.</Text>}
    {failure && <Text role="alert">{failure}</Text>}
    {oldChanged && <>
      <Text>לשונית עם גרסה ישנה שינתה עותק נפרד. המערכות הנוכחיות לא הוחלפו. שמרו את העותק הישן לפני רענון הלשונית; זמן השינויים אינו ידוע.</Text>
      <Group mt="xs">
        {legacy !== null && <Button variant="default" onClick={() => downloadBlob("dibit-older-tab.json", new Blob([legacy], { type: "application/json" }))}>הורדת העותק מהלשונית הישנה</Button>}
        {legacy !== null && <Button variant="default" onClick={() => {
          try { openScheduleRestore(JSON.parse(legacy), "file") }
          catch { setFailure("העותק הישן אינו תקין. הורידו אותו כדי לשמור אפשרות לשחזור.") }
        }}>בדיקת שחזור העותק הישן</Button>}
        <Button variant="subtle" onClick={() => acknowledgeLegacy(legacy)}>השארת המערכות הנוכחיות וסגירת ההודעה</Button>
      </Group>
    </>}
  </Alert>
}
