import {
  Alert,
  Button,
  Group,
  Modal,
  Paper,
  Radio,
  Stack,
  Text,
} from "@mantine/core"
import { useState } from "react"
import { prepareWorkspace } from "../models"
import {
  baseForAccount,
  readSyncBase,
  scheduleKey,
  reviewWorkspaceKey,
  type SyncChoice,
  type SyncReview,
} from "../scheduleSync"
import {
  compareSchedules,
  recheckScheduleChoices,
  workspaceSummary,
  type MergeChoice,
  type ScheduleChange,
} from "../scheduleMerge"
import { useCourseInfo } from "../CourseInfoContext"
import type { CatalogCourses } from "../catalog"
import { formatSemesterInHebrew } from "../utilities"
import type { PlanWorkspace, SchedulePlan } from "../plans"
import type { DibItCourse } from "../schemas"
import { navigationFields, planFields, sharedFields } from "../workspaceFormat"

const courseName = (
  id: string,
  copies: PlanWorkspace[],
  catalog: CatalogCourses,
) => {
  // Resolve the winning definition first; an unnamed override retires earlier names.
  const custom = copies
    .map(
      (copy) =>
        Object.values(copy.customCourses ?? {}).reduce<
          SemesterCourseInfo | undefined
        >((winner, source) => source[id] ?? winner, undefined)?.name,
    )
    .find(Boolean)
  const official = catalog[id]?.name
  return custom ?? official ?? id
}
const semesterName = (semester: string) =>
  /^\d{4}[ab]$/.test(semester) ? formatSemesterInHebrew(semester) : semester
const settingValue = (key: string, value: unknown) => {
  if (key === "theme")
    return value === "apple"
      ? "אפל"
      : value === "google"
        ? "גוגל"
        : "ברירת מחדל"
  return typeof value === "string" ? value : JSON.stringify(value)
}
const selectionDescription = (course: DibItCourse) =>
  [
    course.groups?.length ? `קבוצות ${course.groups.join(", ")}` : "ללא קבוצה",
    ...Object.entries(course)
      .filter(([key]) => !["id", "groups"].includes(key))
      .map(
        ([key, value]) =>
          `${fieldLabels[key] ?? key}: ${settingValue(key, value)}`,
      ),
  ].join(" · ")
const pendingDescription = (
  change: NonNullable<SchedulePlan["pendingAnnualChanges"]>[number],
) =>
  [
    `${semesterName(change.semester)}: ${change.groups === null ? "הסרת הקורס" : `קבוצות ${change.groups.join(", ") || "ללא בחירה"}`}`,
    ...(change.changedGroups
      ? [`קבוצות שהשתנו: ${change.changedGroups.join(", ")}`]
      : []),
    ...Object.entries(change)
      .filter(
        ([key]) => !["id", "semester", "groups", "changedGroups"].includes(key),
      )
      .map(
        ([key, value]) =>
          `${fieldLabels[key] ?? key}: ${settingValue(key, value)}`,
      ),
  ].join("; ")
const description = (
  value: unknown,
  change: ScheduleChange,
  names: (id: string) => string,
): string => {
  if (value === undefined) return "לא כלול בעותק"
  const { kind } = change
  if (kind === "setting" && change.key === JSON.stringify(["setting", "theme"]))
    return settingValue("theme", value)
  if (
    kind === "setting" &&
    value &&
    typeof value === "object" &&
    "name" in value &&
    Object.keys(value).length === 1
  )
    return String(value.name)
  if (
    kind === "setting" &&
    change.planName &&
    value &&
    typeof value === "object"
  )
    return (
      Object.entries(value)
        .filter(([key]) => key !== "id")
        .map(
          ([key, item]) =>
            `${fieldLabels[key] ?? key}: ${settingValue(key, item)}`,
        )
        .join(" · ") || "לא מוגדר"
    )
  if (kind === "course") {
    const bundle = value as {
      courses: Record<string, DibItCourse>
      pending: NonNullable<SchedulePlan["pendingAnnualChanges"]>
    }
    return [
      ...Object.entries(bundle.courses).map(
        ([semester, course]) =>
          `${semesterName(semester)}: ${selectionDescription(course)}`,
      ),
      ...bundle.pending.map(
        (change) => `שינוי שנתי ממתין: ${pendingDescription(change)}`,
      ),
    ].join("; ")
  }
  if (kind === "plan") {
    const plan = value as SchedulePlan
    return [
      plan.name,
      ...Object.entries(plan.courses ?? {}).map(
        ([semester, courses]) =>
          `${semesterName(semester)}: ${courses.map((course) => `${names(course.id)} — ${selectionDescription(course)}`).join("; ") || "ללא קורסים"}`,
      ),
      ...Object.entries(plan)
        .filter(
          ([key]) =>
            !["id", "name", "courses", "pendingAnnualChanges"].includes(key),
        )
        .map(
          ([key, item]) =>
            `${fieldLabels[key] ?? key}: ${settingValue(key, item)}`,
        ),
      ...(plan.pendingAnnualChanges ?? []).map(
        (change) =>
          `שינוי שנתי ממתין: ${names(change.id)} — ${pendingDescription(change)}`,
      ),
    ]
      .filter(Boolean)
      .join(" · ")
  }
  if (kind === "order" && Array.isArray(value))
    return (value as string[]).map(names).join(" ← ") || "ריק"
  return typeof value === "string" ? value : JSON.stringify(value)
}
const fieldLabels: Record<string, string> = {
  name: "שם המערכת",
  color: "צבע",
  studyPlanCategory: "קטגוריה בתוכנית הלימודים",
  awaitingClassification: "ממתין לסיווג",
  school: "חוג",
  studyPlan: "תוכנית לימודים",
  degreeStartYear: "שנת תחילת לימודים",
  savedStudyPlans: "תוכניות לימודים שמורות",
  theme: "עיצוב",
  practicedExams: "מבחנים שתורגלו",
  openedPracticeCourses: "קורסים לתרגול",
  customCourses: "קורסים אישיים",
  pendingAnnualChanges: "שינויים שנתיים ממתינים",
}
const extraFields = (value: object, omitted: string[]) =>
  Object.entries(value)
    .filter(([key]) => !omitted.includes(key))
    .map(([key, value]) => (
      <Text size="sm" key={key} style={{ overflowWrap: "anywhere" }}>
        {fieldLabels[key] ?? key}: {settingValue(key, value)}
      </Text>
    ))
const archivedFields = (value: object, fields: readonly string[]) => {
  const archived = Object.fromEntries(
    Object.entries(value).filter(([key]) => fields.includes(key)),
  )
  return Object.keys(archived).length ? (
    <details>
      <summary>נתונים ישנים לשחזור — אינם פעילים</summary>
      {extraFields(archived, [])}
    </details>
  ) : null
}
export const CopyContents = ({
  title,
  time,
  workspace,
  names,
}: {
  title: string
  time: string
  workspace: PlanWorkspace | undefined
  names: (id: string) => string
}) => (
  <Paper withBorder p="sm">
    <Text fw={500}>{title}</Text>
    <Text size="sm">{time}</Text>
    {workspace ? (
      workspaceSummary(workspace).map((plan) => (
        <div key={plan.id}>
          <Text mt="xs">{plan.name}</Text>
          <Text size="sm">
            {plan.semesters
              .map(
                (semester) =>
                  `${semesterName(semester.semester)}: ${semester.count} קורסים`,
              )
              .join(" · ") || "ללא קורסים"}
          </Text>
        </div>
      ))
    ) : (
      <Text>אין עותק בגוגל</Text>
    )}
    {workspace && (
      <details>
        <summary>פירוט התוכן והבחירות</summary>
        {workspace.plans.map((plan) => (
          <div key={plan.id}>
            <Text fw={500} mt="sm">
              {plan.name}
            </Text>
            {Object.entries(plan.courses ?? {}).map(([semester, courses]) => (
              <div key={semester}>
                <Text fw={500} size="sm">
                  {semesterName(semester)}
                </Text>
                {courses.map((course) => (
                  <div key={course.id}>
                    <Text size="sm">
                      {names(course.id)} ({course.id}) —{" "}
                      {course.groups?.length
                        ? `קבוצות ${course.groups.join(", ")}`
                        : "ללא קבוצה"}
                    </Text>
                    {extraFields(course, ["id", "groups"])}
                  </div>
                ))}
              </div>
            ))}
            {extraFields(plan, [
              "id",
              "name",
              "courses",
              ...navigationFields,
              ...sharedFields,
              "activePlanId",
            ])}
            {archivedFields(plan, [
              ...navigationFields,
              ...sharedFields,
              "activePlanId",
            ])}
          </div>
        ))}
        {extraFields(workspace, [
          "plans",
          "activePlanId",
          "semester",
          "tab",
          "schemaVersion",
          ...planFields,
          "pendingAnnualChanges",
        ])}
        {archivedFields(workspace, [...planFields, "pendingAnnualChanges"])}
      </details>
    )}
  </Paper>
)

export default function ScheduleConflict({
  uid,
  review,
  onClose,
  onResolve,
}: {
  uid: string
  review: SyncReview
  onClose: () => void
  onResolve: (
    review: SyncReview,
    choices: Record<string, MergeChoice> | SyncChoice,
  ) => void
}) {
  const catalog = useCourseInfo()
  const local = review.local.workspace
  const remote = review.remote?.workspace
  const base = readSyncBase(baseForAccount(review.local, uid))
  const comparison = remote ? compareSchedules(base, local, remote) : undefined
  const [answers, setAnswers] = useState(() => ({
    changes: remote
      ? compareSchedules(base, local, remote, review.choices).changes
      : [],
    choices: review.choices ?? ({} as Record<string, MergeChoice>),
  }))
  const [whole, setWhole] = useState<{
    version: string
    choice: "upload" | "download"
  }>()
  const version = reviewWorkspaceKey(local) + reviewWorkspaceKey(remote ?? null)
  const wholeChoice = whole?.version === version ? whole.choice : undefined
  const names = (id: string) =>
    courseName(id, remote ? [local, remote] : [local], catalog)
  const combined = remote
    ? recheckScheduleChoices(
        base,
        local,
        remote,
        answers.changes,
        answers.choices,
      )
    : undefined
  const changes = combined?.changes ?? []
  const choices = combined?.choices ?? {}
  const conflicts = changes.filter((change) => change.conflict)
  const remaining = conflicts.filter((change) => !choices[change.key]).length
  const describe = (value: unknown, change: ScheduleChange) =>
    description(
      value,
      change,
      change.key === "plan-order"
        ? (id) =>
            [local, remote]
              .flatMap((copy) => copy?.plans ?? [])
              .find((plan) => plan.id === id)?.name ?? id
        : names,
    )

  // Reconciliation must not change the selections the user just approved.
  const prepared = (() => {
    try {
      return {
        changed:
          combined?.workspace &&
          scheduleKey(prepareWorkspace(combined.workspace)) !==
            scheduleKey(combined.workspace),
        error: "",
      }
    } catch {
      return {
        changed: false,
        error: "לא ניתן לשמור את הבחירות האלה כרגע. הנתונים לא שונו.",
      }
    }
  })()
  const needsWholeChoice = !!comparison?.reason || !!prepared.changed
  const invalidChoices = !comparison?.reason && !!combined?.reason

  return (
    <Modal
      opened
      onClose={onClose}
      title={needsWholeChoice ? "באילו מערכות להמשיך?" : "אילו שינויים לשמור?"}
      size="lg"
      centered
      styles={{
        content: {
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100dvh - 2rem)",
        },
        body: {
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        },
      }}
    >
      <Stack dir="rtl" style={{ minHeight: 0 }}>
        <Stack style={{ minHeight: 0, overflowY: "auto" }}>
          {needsWholeChoice ? (
            <>
              <Text>
                במכשיר ובחשבון יש מערכות שונות שאי אפשר לשלב בבטחה. בחרו באילו
                מערכות להמשיך בכל המכשירים.
              </Text>
              <Radio.Group
                label="המערכות לשימוש בכל המכשירים"
                value={wholeChoice ?? ""}
                onChange={(choice) =>
                  setWhole({ version, choice: choice as "upload" | "download" })
                }
              >
                <Stack>
                  <Radio value="upload" label="המערכות במכשיר הזה" />
                  <CopyContents
                    title="במכשיר הזה"
                    time=""
                    workspace={local}
                    names={names}
                  />
                  {remote && (
                    <>
                      <Radio
                        value="download"
                        label="המערכות שכבר מסונכרנות בחשבון"
                      />
                      <CopyContents
                        title="בחשבון"
                        time=""
                        workspace={remote}
                        names={names}
                      />
                    </>
                  )}
                </Stack>
              </Radio.Group>
              <Alert color="yellow">
                המערכות שנבחרו יחליפו את האחרות, כולל כל הסמסטרים וההגדרות.
              </Alert>
            </>
          ) : (
            <>
              <Text>
                אותם פרטים השתנו בשני מקומות. שאר השינויים יסתנכרנו אוטומטית.
              </Text>
              {conflicts.map((change) => (
                <Paper
                  key={change.key}
                  withBorder
                  p="sm"
                  style={{ overflowWrap: "anywhere" }}
                >
                  <Radio.Group
                    label={
                      change.courseId
                        ? `${names(change.courseId)} · ${change.planName} · ${change.year}`
                        : change.label
                    }
                    value={choices[change.key] ?? ""}
                    onChange={(choice) =>
                      setAnswers({
                        changes,
                        choices: {
                          ...choices,
                          [change.key]: choice as MergeChoice,
                        },
                      })
                    }
                  >
                    <Stack gap="sm" mt="sm">
                      <Radio
                        value="local"
                        label={`במכשיר הזה: ${describe(change.local, change)}`}
                      />
                      <Radio
                        value="remote"
                        label={`בחשבון: ${describe(change.remote, change)}`}
                      />
                    </Stack>
                  </Radio.Group>
                </Paper>
              ))}
              {!conflicts.length && (
                <Text>
                  אין בחירות נוספות. הסנכרון ישלים את העדכון אוטומטית.
                </Text>
              )}
            </>
          )}
        </Stack>
        <Stack
          gap="xs"
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--mantine-color-default-border)",
            paddingTop: 8,
          }}
        >
          {prepared.error && <Alert color="yellow">{prepared.error}</Alert>}
          {invalidChoices && (
            <Alert color="yellow">
              הבחירות האלה לא משאירות מערכת שעות תקינה. בחרו אפשרות אחרת.
            </Alert>
          )}
          {!needsWholeChoice && remaining > 0 && (
            <Text size="sm" role="status">
              {remaining === 1
                ? "נותרה בחירה אחת"
                : `נותרו ${remaining} בחירות`}
            </Text>
          )}
          <Group justify="space-between">
            <Button variant="default" onClick={onClose}>
              אחר כך
            </Button>
            <Button
              h="auto"
              py="xs"
              styles={{
                root: { maxWidth: "100%" },
                label: { whiteSpace: "normal" },
              }}
              disabled={
                !!prepared.error ||
                (needsWholeChoice
                  ? !wholeChoice
                  : !combined?.workspace || !conflicts.length)
              }
              onClick={() =>
                onResolve(review, needsWholeChoice ? wholeChoice! : choices)
              }
            >
              {needsWholeChoice
                ? "שימוש במערכות האלה בכל המכשירים"
                : "שמירה והמשך סנכרון"}
            </Button>
          </Group>
        </Stack>
      </Stack>
    </Modal>
  )
}
