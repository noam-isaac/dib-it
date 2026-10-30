import { Alert, Button, Group, Stack, Text } from "@mantine/core"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { useState } from "react"
import { getWorkspace, setWorkspace } from "../models"
import { normalizePlans, type PlanWorkspace } from "../plans"
import { isScheduleBackup } from "../scheduleBackup"
import { downloadBlob } from "../utilities"

export const downloadWorkspaceBackup = (filename = "dibit.json") =>
  downloadBlob(filename, new Blob([JSON.stringify(getWorkspace())], { type: "application/json" }))

const RestoreScheduleModal = ({ backup, source }: { backup: PlanWorkspace; source: "file" | "google" }) => {
  const [error, setError] = useState("")
  return (
    <Stack dir="rtl">
      <Alert color="yellow" title="השחזור מחליף את כל המערכות הנוכחיות">
        כל מערכות השעות בכל הסמסטרים וההגדרות המשותפות יוחלפו בתוכן הגיבוי. אם הסנכרון האוטומטי פעיל, השינוי יסתנכרן גם למכשירים האחרים.
      </Alert>
      <Text fw={600}>מערכות השעות בגיבוי ({backup.plans.length}):</Text>
      <ul style={{ margin: 0, paddingInlineStart: 24, maxHeight: 200, overflowY: "auto" }}>
        {backup.plans.map(plan => (
          <li key={plan.id} style={{ overflowWrap: "anywhere" }}>
            {plan.name}{plan.id === backup.activePlanId && " — תיפתח לאחר השחזור"}
          </li>
        ))}
      </ul>
      <Text size="sm">כדי שתוכלו לחזור למצב הנוכחי, הורידו גיבוי לפני השחזור. אפשר לשחזר אותו מאותו תפריט.</Text>
      <Button variant="default" styles={{ label: { whiteSpace: "normal" } }} h="auto" py="xs" onClick={() => {
        try {
          downloadWorkspaceBackup("dibit-before-restore.json")
          setError("")
        } catch {
          setError("הורדת הגיבוי נכשלה. המערכות הנוכחיות נשארו כפי שהן.")
        }
      }}>הורדת גיבוי של המערכות הנוכחיות</Button>
      {error && <Text role="alert" c="red" size="sm">{error}</Text>}
      <Group justify="space-between">
        <Button variant="default" data-autofocus onClick={() => modals.closeAll()}>ביטול</Button>
        <Button color="red" onClick={() => {
          try {
            const latest = getWorkspace()
            setWorkspace({
              ...backup,
              semester: source === "google" ? latest.semester ?? backup.semester : backup.semester || latest.semester,
              tab: source === "google" ? latest.tab ?? backup.tab : backup.tab,
            })
            modals.closeAll()
            notifications.show({ title: "השחזור הושלם", message: `שוחזרו ${backup.plans.length} מערכות שעות.`, color: "green" })
          } catch {
            setError("לא ניתן לשמור את השחזור בדפדפן. המערכות הנוכחיות נשארו כפי שהן.")
          }
        }}>החלפת כל המערכות ושחזור</Button>
      </Group>
    </Stack>
  )
}

/** File and Google restores must pass the same validation and confirmation. */
export const openScheduleRestore = (data: unknown, source: "file" | "google") => {
  if (!isScheduleBackup(data)) throw new Error("הקובץ אינו גיבוי תקין של Dib It.")
  modals.open({
    title: source === "google" ? "שחזור מגוגל" : "שחזור מקובץ",
    centered: true,
    children: <RestoreScheduleModal backup={normalizePlans(data)} source={source} />,
  })
}
