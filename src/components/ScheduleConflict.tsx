import { Alert, Button, Group, Paper, Radio, SimpleGrid, Stack, Text } from "@mantine/core"
import { useMemo, useState } from "react"
import { commitSyncReview, loadSyncReview } from "../googleWorkspace"
import { prepareWorkspace, useWorkspace } from "../models"
import { baseForAccount, cloudScheduleData, type SyncChoice, type SyncReview } from "../scheduleSync"
import { compareSchedules, sharedMergeBase, workspaceSummary, type MergeChoice, type ScheduleChange } from "../scheduleMerge"
import { readWorkspaceRecord } from "../workspaceStore"
import { useCourseInfo } from "../CourseInfoContext"
import type { CatalogCourses } from "../catalog"
import { downloadBlob } from "../utilities"
import type { PlanWorkspace } from "../plans"

const date = (at: number | null | undefined) => at == null ? "זמן לא זמין" : new Intl.DateTimeFormat("he-IL", {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
}).format(at)
const courseName = (id: string, copies: PlanWorkspace[], catalog: CatalogCourses) => {
  const custom = copies.flatMap(copy => Object.values(copy.customCourses ?? {})).find(catalog => catalog[id]?.name)?.[id]?.name
  const official = catalog[id]?.name
  return custom ?? official ?? id
}
const description = (value: unknown, kind: ScheduleChange["kind"], names: (id: string) => string): string => {
  if (value === undefined) return "לא כלול בעותק"
  if (kind === "course") {
    const bundle = value as { courses: Record<string, { groups?: string[]; color?: string; studyPlanCategory?: string }>; pending: { semester: string; groups: string[] | null; changedGroups?: string[] }[] }
    return Object.entries(bundle.courses).map(([semester, course]) => [
      `${semester}: ${course.groups?.length ? `קבוצות ${course.groups.join(", ")}` : "ללא קבוצה"}${course.color ? ` · צבע ${course.color}` : ""}${course.studyPlanCategory ? ` · ${course.studyPlanCategory}` : ""}`,
      ...Object.entries(course).filter(([key]) => !["id", "groups", "color", "studyPlanCategory"].includes(key)).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    ].join(" · ")).join("; ") + (bundle.pending.length ? ` · שינויים שנתיים ממתינים: ${bundle.pending.map(change => `${change.semester}: ${change.groups === null ? "הסרת הקורס" : `קבוצות ${change.groups.join(", ") || "ללא בחירה"}`}${change.changedGroups ? `; קבוצות שהשתנו: ${change.changedGroups.join(", ")}` : ""}`).join("; ")}` : "")
  }
  if (kind === "plan") {
    const plan = value as { name?: string; courses?: Record<string, { id: string; groups?: string[] }[]> }
    return [plan.name, ...Object.entries(plan.courses ?? {}).map(([semester, courses]) => `${semester}: ${courses.map(course => `${names(course.id)} — קבוצות ${course.groups?.join(", ") || "ללא בחירה"}`).join("; ") || "ללא קורסים"}`)].filter(Boolean).join(" · ")
  }
  if (kind === "order" && Array.isArray(value)) return (value as string[]).map(names).join(" ← ") || "ריק"
  return typeof value === "string" ? value : JSON.stringify(value)
}
const fieldLabels: Record<string, string> = { school: "חוג", studyPlan: "תוכנית לימודים", degreeStartYear: "שנת תחילת לימודים", savedStudyPlans: "תוכניות לימודים שמורות", theme: "עיצוב", practicedExams: "מבחנים שתורגלו", openedPracticeCourses: "קורסים לתרגול", customCourses: "קורסים אישיים", pendingAnnualChanges: "שינויים שנתיים ממתינים" }
const extraFields = (value: object, omitted: string[]) => Object.entries(value).filter(([key]) => !omitted.includes(key)).map(([key, value]) =>
  <Text size="sm" key={key} style={{ overflowWrap: "anywhere" }}>{fieldLabels[key] ?? key}: {typeof value === "string" ? value : JSON.stringify(value)}</Text>)
const CopyContents = ({ title, time, workspace, names }: { title: string; time: string; workspace: PlanWorkspace | undefined; names: (id: string) => string }) => <Paper withBorder p="sm">
  <Text fw={500}>{title}</Text><Text size="sm">{time}</Text>
  {workspace ? workspaceSummary(workspace).map(plan => <div key={plan.id}>
    <Text mt="xs">{plan.name}</Text>
    <Text size="sm">{plan.semesters.map(semester => `${semester.semester}: ${semester.count} קורסים`).join(" · ") || "ללא קורסים"}</Text>
  </div>) : <Text>אין גיבוי</Text>}
  {workspace && <details><summary>פירוט התוכן והבחירות</summary>
    {workspace.plans.map(plan => <div key={plan.id}>
      <Text fw={500} mt="sm">{plan.name}</Text>
      {Object.entries(plan.courses ?? {}).map(([semester, courses]) => <div key={semester}>
        <Text fw={500} size="sm">{semester}</Text>
        {courses.map(course => <div key={course.id}>
          <Text size="sm">{names(course.id)} ({course.id}) — {course.groups?.length ? `קבוצות ${course.groups.join(", ")}` : "ללא קבוצה"}</Text>
          {extraFields(course, ["id", "groups"])}
        </div>)}
      </div>)}
      {extraFields(plan, ["id", "name", "courses"])}
    </div>)}
    {extraFields(workspace, ["plans", "activePlanId", "semester", "tab"])}
  </details>}
</Paper>

export default function ScheduleConflict({ uid, initial, initialChoice, onClose }: {
  uid: string; initial: SyncReview; initialChoice?: SyncChoice; onClose: () => void
}) {
  useWorkspace()
  const catalog = useCourseInfo()
  const [review, setReview] = useState(initial)
  const [choice, setChoice] = useState<SyncChoice | undefined>(initialChoice)
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const local = review.local.workspace, remote = review.remote?.workspace
  const baseKey = baseForAccount(review.local, uid)
  const base = useMemo(() => sharedMergeBase(baseKey), [baseKey])
  const comparison = useMemo(() => remote ? compareSchedules(base, local, remote, choices) : undefined, [base, local, remote, choices])
  const prepared = (() => {
    if (!comparison?.workspace) return { workspace: undefined, error: "" }
    try { return { workspace: cloudScheduleData(prepareWorkspace(comparison.workspace), uid, 92), error: "" } }
    catch (error) { return { workspace: undefined, error: error instanceof Error ? error.message : "לא ניתן לשמור את התוצאה." } }
  })()
  const stale = readWorkspaceRecord().version !== review.local.version
  const names = (id: string) => courseName(id, remote ? [local, remote] : [local], catalog)
  const changes = [...comparison?.changes ?? []].sort((a, b) => Number(b.conflict) - Number(a.conflict) || Number(b.local === undefined || b.remote === undefined) - Number(a.local === undefined || a.remote === undefined))
  const download = (workspace: PlanWorkspace, filename: string) => {
    try { downloadBlob(filename, new Blob([JSON.stringify(workspace)], { type: "application/json" })) }
    catch { setMessage("הורדת הגיבוי נכשלה. נסו שוב לפני החלפת עותק.") }
  }
  const row = (change: ScheduleChange) => <Paper key={change.key} withBorder p="sm">
    <Text fw={500}>{change.courseId ? `${names(change.courseId)} (${change.courseId}) · ${change.planName} · ${change.year}` : change.label}</Text>
    {change.conflict && <Text size="sm" c="orange">בחירות מתחרות — נדרשת החלטה במיזוג</Text>}
    {base && <Text size="sm">בעותק המשותף הקודם: {description(change.base, change.kind, names)}</Text>}
    <Text size="sm">במכשיר: {description(change.local, change.kind, names)}</Text>
    <Text size="sm">בגוגל: {description(change.remote, change.kind, names)}</Text>
    {change.kind === "plan" && <details><summary>הגדרות המערכת בכל עותק</summary>
      {[["במכשיר", change.local], ["בגוגל", change.remote]].map(([label, value]) => <div key={String(label)}>
        <Text fw={500} size="sm">{String(label)}</Text>{value && typeof value === "object" ? extraFields(value, ["id", "name", "courses"]) : <Text size="sm">לא כלול בעותק</Text>}
      </div>)}
    </details>}
    {choice === "merge" && change.conflict && <Radio.Group mt="xs" label={`בחירה עבור ${change.courseId ? names(change.courseId) : change.label}`} value={choices[change.key] ?? ""}
      onChange={value => setChoices(current => ({ ...current, [change.key]: value as MergeChoice }))}>
      <Group><Radio disabled={busy} value="local" label="הבחירה במכשיר" /><Radio disabled={busy} value="remote" label="הבחירה בגוגל" /></Group>
    </Radio.Group>}
  </Paper>
  return <Stack dir="rtl">
    <Text>השוו את כל המערכות וההגדרות בשני העותקים לפני בחירה. זמן מאוחר יותר אינו מעיד שהעותק שלם יותר.</Text>
    <Text size="sm">זמן העדכון המקומי תלוי בשעון המכשיר. שמות הקורסים מוצגים לפי המידע הזמין במכשיר.</Text>
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <CopyContents title="העותק במכשיר" time={`${review.local.time?.source === "google" ? "תוכן שהגיע מגוגל" : "עדכון מקומי"}: ${date(review.local.time?.at)}`} workspace={local} names={names} />
      <CopyContents title="העותק בגוגל" time={`נשמר בגוגל: ${date(review.remote?.savedAt)}`} workspace={remote} names={names} />
    </SimpleGrid>
    <Group>
      <Button variant="default" onClick={() => download(local, "dibit-local-before-sync.json")}>הורדת העותק המקומי</Button>
      {remote && <Button variant="default" onClick={() => download(remote, "dibit-google-before-sync.json")}>הורדת העותק מגוגל</Button>}
    </Group>
    <Text fw={500}>{base ? "השינויים מאז העותק המשותף האחרון" : "הבדלים בין העותקים — ללא היסטוריה משותפת"}</Text>
    {!!changes.length && <Text size="sm">{changes.length} סעיפים להשוואה · {comparison?.unresolved.length ?? 0} בחירות מתחרות שטרם הוכרעו</Text>}
    {!changes.length && <Text>אין הבדלי תוכן להצגה.</Text>}
    {changes.slice(0, 5).map(row)}
    {changes.length > 5 && <details open={choice === "merge"}><summary>כל ההבדלים ({changes.length})</summary><Stack mt="sm">{changes.slice(5).map(row)}</Stack></details>}
    <Group>
      <Button variant={choice === "merge" ? "filled" : "default"} disabled={busy || !remote || !!comparison?.reason} onClick={() => setChoice("merge")}>בדיקת מיזוג</Button>
      <Button disabled={busy} variant={choice === "upload" ? "filled" : "default"} onClick={() => setChoice("upload")}>שימוש בעותק מהמכשיר</Button>
      {remote && <Button disabled={busy} variant={choice === "download" ? "filled" : "default"} onClick={() => setChoice("download")}>שימוש בעותק מגוגל</Button>}
    </Group>
    {comparison?.reason && <Text size="sm">{comparison.reason}</Text>}
    {choice === "merge" && <>
      <Text>{comparison?.unresolved.length ? `${comparison.unresolved.length} החלטות עדיין נדרשות. שינויים עצמאיים יישמרו משני העותקים.` : "השינויים העצמאיים והבחירות שלכם יישמרו יחד."}</Text>
      {prepared.workspace && <CopyContents title="תוצאת המיזוג לשמירה" time="תצוגה מקדימה — טרם נשמרה, לאחר התאמה לקטלוג הזמין במכשיר" workspace={prepared.workspace} names={names} />}
      <Text size="sm">מיזוג שומר בחירות; הוא אינו בודק התנגשויות בשעות או תנאי רישום.</Text>
      {prepared.error && <Alert color="red">{prepared.error}</Alert>}
    </>}
    {choice && choice !== "merge" && <Alert color="yellow">{choice === "upload" ? "כל התוכן השונה בעותק מגוגל יוחלף בעותק מהמכשיר." : "כל התוכן השונה במכשיר יוחלף בעותק מגוגל."} ההבדלים מוצגים למעלה. פעולה זו אינה מיזוג.</Alert>}
    {(stale || message) && <Alert color="yellow" role="status">{stale ? "הנתונים במכשיר השתנו. רעננו את ההשוואה לפני שמירה." : message}</Alert>}
    <Group justify="space-between">
      <Button variant="default" disabled={busy} onClick={onClose}>ביטול</Button>
      <Button variant="default" loading={busy} onClick={async () => {
        setBusy(true)
        try { setReview(await loadSyncReview(uid)); setChoices({}); setMessage("ההשוואה עודכנה. בדקו מחדש את הבחירות.") }
        catch (error) { setMessage(error instanceof Error ? error.message : "רענון ההשוואה נכשל.") }
        finally { setBusy(false) }
      }}>רענון ההשוואה</Button>
      <Button color={choice === "merge" ? "cyan" : "red"} loading={busy} disabled={!choice || stale || (choice === "merge" && !prepared.workspace)} onClick={async () => {
        if (!choice) return
        setBusy(true); setMessage("")
        try {
          const status = await commitSyncReview(uid, review, choice, prepared.workspace)
          if (status === "synced") onClose()
          else setMessage("הפעולה בגוגל הושלמה, אך במכשיר יש שינויים נוספים שטרם סונכרנו. הם נשמרו; רעננו את ההשוואה.")
        } catch (error) { setMessage(error instanceof Error ? error.message : "השמירה לא הושלמה. העותק המקומי נשמר.") }
        finally { setBusy(false) }
      }}>{choice === "merge" ? "שמירת המיזוג" : choice === "download" ? "אישור החלפת המערכות במכשיר" : "אישור החלפת העותק בגוגל"}</Button>
    </Group>
  </Stack>
}
