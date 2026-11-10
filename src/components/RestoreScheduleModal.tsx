import { Alert, Button, Group, Stack, Text } from "@mantine/core"
import { modals } from "@mantine/modals"
import { notifications } from "@mantine/notifications"
import { useEffect, useState } from "react"
import { getWorkspace, setWorkspace } from "../models"
import { type PlanWorkspace } from "../plans"
import { readScheduleBackup } from "../scheduleBackup"
import { downloadBlob } from "../utilities"
import { UnsupportedWorkspaceVersionError } from "../workspaceFormat"
import { reviewWorkspaceKey } from "../scheduleSync"
import { CopyContents } from "./ScheduleConflict"
import { useCourseInfo } from "../CourseInfoContext"

export const downloadWorkspaceBackup = (filename = "dibit.json") =>
  downloadBlob(
    filename,
    new Blob([JSON.stringify(getWorkspace())], { type: "application/json" }),
  )

const readRestoreCopy = () => {
  try {
    const workspace = getWorkspace()
    return { workspace, version: reviewWorkspaceKey(workspace) }
  } catch {
    // Recovery must remain available when the current copy cannot be decoded.
    return { workspace: undefined, version: localStorage.getItem("Dib It") }
  }
}

const RestoreScheduleModal = ({
  backup,
  source,
  raw,
  initial,
}: {
  backup: PlanWorkspace
  source: "file" | "google"
  raw: string
  initial: ReturnType<typeof readRestoreCopy>
}) => {
  const [error, setError] = useState("")
  const [current, setCurrent] = useState(initial)
  const [reviewedVersion, setReviewedVersion] = useState(initial.version)
  const catalog = useCourseInfo()
  const stale = current.version !== reviewedVersion
  useEffect(() => {
    const refresh = () => setCurrent(readRestoreCopy())
    refresh()
    window.addEventListener("storage", refresh)
    return () => window.removeEventListener("storage", refresh)
  }, [])

  const restore = () => {
    try {
      const latest = readRestoreCopy()
      if (latest.version !== reviewedVersion) {
        setCurrent(latest)
        return
      }
      setWorkspace(
        {
          ...backup,
          semester:
            source === "google"
              ? (latest.workspace?.semester ?? backup.semester)
              : backup.semester || latest.workspace?.semester,
          tab:
            source === "google"
              ? (latest.workspace?.tab ?? backup.tab)
              : backup.tab,
        },
        { kind: source, raw },
      )
      modals.closeAll()
      notifications.show({
        title: "השחזור הושלם",
        message: `שוחזרו ${backup.plans.length} מערכות שעות.`,
        color: "green",
      })
    } catch (failure) {
      setError(
        failure instanceof UnsupportedWorkspaceVersionError
          ? failure.message
          : "לא ניתן לשמור את השחזור בדפדפן. המערכות הנוכחיות נשארו כפי שהן.",
      )
    }
  }
  return (
    <Stack dir="rtl">
      <Alert color="yellow" title="השחזור מחליף את כל המערכות הנוכחיות">
        כל מערכות השעות בכל הסמסטרים וההגדרות המשותפות יוחלפו בתוכן הגיבוי.
        <Text fw={600} mt="xs">
          כשהסנכרון פעיל, השחזור יסתנכרן גם לגוגל ולשאר המכשירים — כולל מחיקות
          ושינויים בבחירות הקורסים.
        </Text>
      </Alert>
      <Text fw={600}>מערכות השעות בגיבוי ({backup.plans.length}):</Text>
      <ul
        style={{
          margin: 0,
          paddingInlineStart: 24,
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        {backup.plans.map((plan) => (
          <li key={plan.id} style={{ overflowWrap: "anywhere" }}>
            {plan.name}
            {plan.id === backup.activePlanId && " — תיפתח לאחר השחזור"}
          </li>
        ))}
      </ul>
      {current.version !== initial.version && current.workspace && (
        <CopyContents
          title="המערכות הנוכחיות לאחר השינויים"
          time="העותק שיוחלף בשחזור"
          workspace={current.workspace}
          names={(id) => catalog[id]?.name ?? id}
        />
      )}
      {stale && (
        <Alert color="yellow" role="alert">
          המערכות השתנו מאז פתיחת השחזור. בדקו את המצב המעודכן לפני החלפתו
          בגיבוי.
          <Button
            variant="subtle"
            onClick={() => setReviewedVersion(current.version)}
          >
            בדקתי את המצב המעודכן
          </Button>
        </Alert>
      )}
      <Text size="sm">
        כדי שתוכלו לחזור למצב הנוכחי, הורידו גיבוי לפני השחזור. אפשר לשחזר אותו
        מאותו תפריט.
      </Text>
      <Button
        variant="default"
        styles={{ label: { whiteSpace: "normal" } }}
        h="auto"
        py="xs"
        onClick={() => {
          try {
            downloadWorkspaceBackup("dibit-before-restore.json")
            setError("")
          } catch {
            setError("הורדת הגיבוי נכשלה. המערכות הנוכחיות נשארו כפי שהן.")
          }
        }}
      >
        הורדת גיבוי של המערכות הנוכחיות
      </Button>
      {error && (
        <Text role="alert" c="red" size="sm">
          {error}
        </Text>
      )}
      <Group justify="space-between">
        <Button
          variant="default"
          data-autofocus
          onClick={() => modals.closeAll()}
        >
          ביטול
        </Button>
        <Button color="red" disabled={stale} onClick={restore}>
          החלפת כל המערכות ושחזור
        </Button>
      </Group>
    </Stack>
  )
}

/** File and Google restores must pass the same validation and confirmation. */
export const openScheduleRestore = (
  data: unknown,
  source: "file" | "google",
  raw = JSON.stringify(data),
) => {
  const backup = readScheduleBackup(data)
  modals.open({
    title: source === "google" ? "שחזור מגוגל" : "שחזור מקובץ",
    centered: true,
    children: (
      <RestoreScheduleModal
        backup={backup}
        source={source}
        raw={raw}
        initial={readRestoreCopy()}
      />
    ),
  })
}
