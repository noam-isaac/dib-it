import { z } from "zod"
import {
  navigationSchema,
  planDataSchema,
  sharedSettingsSchema,
  workspaceSchema,
} from "./schemas"
import type { PlanWorkspace } from "./plans"

export const WORKSPACE_VERSION = 1 as const
export const navigationFields = Object.keys(
  navigationSchema.shape,
) as (keyof typeof navigationSchema.shape)[]
export const sharedFields = Object.keys(
  sharedSettingsSchema.shape,
) as (keyof typeof sharedSettingsSchema.shape)[]
export const planFields = Object.keys(
  planDataSchema.shape,
) as (keyof typeof planDataSchema.shape)[]
const record = z.record(z.string(), z.unknown())
const owns = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key)
const pick = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(
    keys.filter((key) => owns(value, key)).map((key) => [key, value[key]]),
  )
const without = (value: object, keys: readonly string[]) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  )

/** Firestore sorts map keys, so source precedence travels as a separate list. */
export const withCatalogSourceOrder = (
  workspace: PlanWorkspace,
  sources: string[],
): PlanWorkspace => {
  const catalogs = workspace.customCourses ?? {}
  if (
    sources.length !== Object.keys(catalogs).length ||
    new Set(sources).size !== sources.length ||
    sources.some((source) => !owns(catalogs, source))
  )
    throw new Error("סדר מקורות הקורסים בגוגל אינו תקין. הנתונים לא שונו.")
  return workspace.customCourses === undefined
    ? workspace
    : {
        ...workspace,
        customCourses: Object.fromEntries(
          sources.map((source) => [source, catalogs[source]!]),
        ),
      }
}
const fingerprint = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  )
const sharedNames = {
  theme: "העיצוב",
  customCourses: "הקורסים האישיים",
  practicedExams: "המבחנים שתורגלו",
  openedPracticeCourses: "הקורסים לתרגול",
}

export class UnsupportedWorkspaceVersionError extends Error {
  constructor(readonly version: unknown) {
    super(
      "גרסת הנתונים אינה נתמכת בגרסה זו של Dib It. עדכנו את האתר או הורידו את הנתונים לשחזור; הנתונים המקוריים לא שונו.",
    )
  }
}
export const workspaceVersion = (value: unknown): 0 | 1 => {
  const data = record.parse(value)
  if (!owns(data, "schemaVersion")) return 0
  if (data.schemaVersion !== WORKSPACE_VERSION)
    throw new UnsupportedWorkspaceVersionError(data.schemaVersion)
  return WORKSPACE_VERSION
}

/** Decode once in memory. Saving and preserving original bytes belong to the storage boundary. */
export const decodeWorkspace = (value: unknown): PlanWorkspace => {
  const source = record.parse(value)
  const version = workspaceVersion(source)
  if (version === WORKSPACE_VERSION) return workspaceSchema.parse(source)
  const multi = owns(source, "plans")
  const input = multi
    ? source
    : {
        ...source,
        activePlanId: "default",
        plans: [
          {
            ...pick(source, planFields),
            id: "default",
            name: "מערכת השעות שלי",
          },
        ],
      }
  // Validate identities and owned substantive values before considering historical fallbacks.
  const parsed = workspaceSchema.parse(input)
  const active = parsed.plans.find((plan) => plan.id === parsed.activePlanId)!
  const navigation = Object.fromEntries(
    navigationFields.flatMap((key) => {
      if (owns(source, key)) return [[key, source[key]]]
      const historical = navigationSchema.shape[key].safeParse(active[key])
      return historical.success && historical.data !== undefined
        ? [[key, historical.data]]
        : []
    }),
  )
  const shared = Object.fromEntries(
    sharedFields.flatMap((key) => {
      const effective = parsed.plans.map((plan) =>
        owns(plan, key) ? plan[key] : source[key],
      )
      const candidates = owns(source, key)
        ? [source[key], ...effective]
        : effective
      // Catalog source order controls which overlapping course wins; inner field order does not.
      const fingerprints = candidates.map((value) => {
        const checked = sharedSettingsSchema.shape[key].parse(value)
        return fingerprint(
          key === "customCourses" && checked !== undefined
            ? Object.entries(checked)
            : checked,
        )
      })
      if (new Set(fingerprints).size > 1)
        throw new Error(
          `הגיבוי מכיל ערכים שונים עבור ${sharedNames[key]} במערכות השעות. הנתונים המקוריים נשמרו; נדרש תיקון לפני המרה.`,
        )
      const agreed = sharedSettingsSchema.shape[key].parse(candidates[0])
      return agreed === undefined ? [] : [[key, agreed]]
    }),
  )
  const plans = parsed.plans.map((plan) => ({
    ...plan,
    ...Object.fromEntries(
      planFields.flatMap((key) =>
        owns(plan, key) || !owns(source, key)
          ? []
          : [[key, planDataSchema.shape[key].parse(source[key])]],
      ),
    ),
  }))
  return workspaceSchema.parse({
    ...parsed,
    ...navigation,
    ...shared,
    plans,
    schemaVersion: WORKSPACE_VERSION,
  })
}

const groupSet = (groups: string[]) => [...new Set(groups)].sort()

/** Comparison only: group selections are sets; course and pending-edit order still matters. */
export const normalizeGroupSelections = (
  workspace: PlanWorkspace,
): PlanWorkspace => ({
  ...workspace,
  plans: workspace.plans.map((plan) => {
    const courses =
      plan.courses === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(plan.courses).map(([semester, selections]) => [
              semester,
              selections.map((course) =>
                course.groups === undefined
                  ? course
                  : { ...course, groups: groupSet(course.groups) },
              ),
            ]),
          )
    const pendingAnnualChanges = plan.pendingAnnualChanges?.map((change) => ({
      ...change,
      groups: change.groups === null ? null : groupSet(change.groups),
      ...(change.changedGroups === undefined
        ? {}
        : {
            changedGroups: groupSet(change.changedGroups),
          }),
    }))

    return {
      ...plan,
      ...(courses === undefined ? {} : { courses }),
      ...(pendingAnnualChanges === undefined ? {} : { pendingAnnualChanges }),
    }
  }),
})

/** Inactive historical fields never create sync differences; unfamiliar metadata retains its owner. */
export const workspaceContent = (workspace: PlanWorkspace) => ({
  ...without(workspace, [
    ...navigationFields,
    "activePlanId",
    ...planFields,
    "pendingAnnualChanges",
  ]),
  plans: normalizeGroupSelections(workspace).plans.map((plan) =>
    without(plan, [...navigationFields, ...sharedFields, "activePlanId"]),
  ),
})
