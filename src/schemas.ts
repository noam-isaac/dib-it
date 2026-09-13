import { z } from "zod"

// TAU Tools fields are optional when the scraper has no information.
interface Prerequisites {
  kind?: "any" | "all" | undefined
  courses?: (string | Prerequisites)[] | undefined
  parallel?: Prerequisites | null | undefined
}
const prerequisitesSchema: z.ZodType<Prerequisites> = z.lazy(() =>
  z.looseObject({
    kind: z.enum(["any", "all"]).optional(),
    courses: z.array(z.union([z.string(), prerequisitesSchema])).optional(),
    parallel: prerequisitesSchema.nullish(),
  }),
)
const lessonSchema = z.looseObject({
  day: z.string().optional(),
  time: z.string().optional(),
  building: z.string().optional(),
  room: z.string().optional(),
  type: z.string().optional(),
})
const examSchema = z.looseObject({
  moed: z.string().optional(),
  date: z.string().optional(),
  hour: z.string().optional(),
  type: z.string().optional(),
})
const groupSchema = z.looseObject({
  group: z.string().optional(),
  lecturer: z.string().nullable().optional(),
  lessons: z.array(lessonSchema).optional(),
})
export const courseSchema = z.looseObject({
  name: z.string().optional(),
  faculty: z.string().optional(),
  exams: z.array(examSchema).optional(),
  groups: z.array(groupSchema).optional(),
  exam_links: z.array(z.string()).optional(),
  prerequisites: prerequisitesSchema.nullish(),
})
export const semesterCoursesSchema = z.record(z.string(), courseSchema)
export const allTimeCoursesSchema = z.record(
  z.string(),
  z.object({
    name: z.string().optional(),
    faculty: z.string().optional(),
    semesters: z.array(z.string()).optional(),
    lecturers: z.array(z.string()).optional(),
  }),
)
export const generalInfoSchema = z.object({
  currentSemester: z.string().optional(),
  semesters: z
    .record(
      z.string(),
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .optional(),
})
export const semesterPlansSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        courses: z.record(
          z.string(),
          z.object({
            id: z.string().optional(),
            weight: z.union([z.string(), z.number()]).optional(),
          }),
        ),
        count: z.number(),
      }),
    ),
  ),
)
// Older bidding rounds encode missing winning bids as an empty string.
const bidSchema = z.union([
  z.number().nonnegative(),
  z.literal("").transform(() => null),
])
export const biddingSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.record(
      z.string(),
      z.array(
        z.object({
          faculty: z.string().optional(),
          maximal: bidSchema.optional(),
          minimal: bidSchema.optional(),
          wanted: z.number().optional(),
          received: z.number().optional(),
          run_available: z.number().optional(),
          total_available: z.number().optional(),
        }),
      ),
    ),
  ),
)
export const gradesSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.record(
      z.string(),
      z.array(
        z.object({
          mean: z.number().nullable().optional(),
        }),
      ),
    ),
  ),
)
export const dibItCourseSchema = z.looseObject({
  id: z.string().min(1),
  groups: z.array(z.string()).optional(),
  color: z.string().optional(),
  studyPlanCategory: z.string().optional(),
})
export const dibItSchema = z
  .object({
    activePlanId: z.string().optional(),
    savedStudyPlans: z.array(z.looseObject({ school: z.string().refine(s => !!s.trim()), studyPlan: z.string().refine(s => !!s.trim()) })).optional(),
    courses: z.record(z.string(), z.array(dibItCourseSchema)).optional(),
    tab: z.string().optional(),
    semester: z.string().regex(/^\d{4}[ab]$/).or(z.literal("")).optional(),
    openedPracticeCourses: z.array(z.string()).optional(),
    practicedExams: z.record(z.string(), z.array(z.string())).optional(),
    school: z.string().optional(),
    studyPlan: z.string().optional(),
    degreeStartYear: z.string().optional(),
    theme: z.enum(["apple", "google"]).optional(),
    customCourses: z.record(z.string(), semesterCoursesSchema).optional(),
  })
  .passthrough()
const annualChangeSchema = z.looseObject({
  semester: z.string().regex(/^\d{4}[ab]$/),
  id: z.string().min(1),
  groups: z.array(z.string()).nullable(),
  changedGroups: z.array(z.string()).optional(),
  awaitingClassification: z.literal(true).optional(),
})
export const schedulePlanSchema = dibItSchema.extend({
  id: z.string().refine(s => !!s.trim()),
  name: z.string().refine(s => !!s.trim()),
  pendingAnnualChanges: z.array(annualChangeSchema).optional(),
  plans: z.never().optional(),
})
export const workspaceSchema = dibItSchema.extend({
  plans: z.array(schedulePlanSchema).min(1),
  activePlanId: z.string(),
}).refine(value => new Set(value.plans.map(plan => plan.id)).size === value.plans.length &&
  value.plans.some(plan => plan.id === value.activePlanId))
export const storedWorkspaceSchema = z.union([workspaceSchema, dibItSchema.extend({ plans: z.never().optional() })])
export const scheduleBackupSchema = storedWorkspaceSchema.refine(value =>
  "plans" in value && value.plans !== undefined || [
    "courses", "semester", "tab", "school", "studyPlan", "degreeStartYear", "theme",
    "savedStudyPlans", "openedPracticeCourses", "practicedExams", "customCourses",
  ].some(key => value[key] !== undefined))
export const facultyPointsSchema = z.array(
  z.object({
    faculty: z.string(),
    points: z.number().nonnegative().optional(),
  }),
)
export const stringArraySchema = z.array(z.string())
export const booleanSchema = z.boolean()
export type DibIt = Pick<z.infer<typeof dibItSchema>, keyof typeof dibItSchema.shape>
export type DibItCourse = z.infer<typeof dibItCourseSchema>
export type Grades = z.infer<typeof gradesSchema>
export type FacultyPoints = z.infer<typeof facultyPointsSchema>

// Preserve the existing shared TAU type names, inferred from runtime schemas.
declare global {
  type SemesterCourseInfo = Pick<z.infer<typeof courseSchema>, keyof typeof courseSchema.shape>
  type SemesterCourseExamInfo = Pick<z.infer<typeof examSchema>, keyof typeof examSchema.shape>
  type SemesterCourseGroupInfo = Pick<z.infer<typeof groupSchema>, keyof typeof groupSchema.shape>
  type SemesterCourseGroupLessonInfo = Pick<z.infer<typeof lessonSchema>, keyof typeof lessonSchema.shape>
  type AllTimeCourseInfo = z.infer<typeof allTimeCoursesSchema>[string]
  type YearPlanInfo = z.infer<typeof semesterPlansSchema>[string][string]
  type YearPlanCategoryInfo = YearPlanInfo[string]
  type YearPlanCourseInfo = YearPlanCategoryInfo["courses"][string]
  type GeneralSemesterInfo = NonNullable<z.infer<typeof generalInfoSchema>["semesters"]>[string]
  type GroupBiddingInfo = z.infer<typeof biddingSchema>[string][string][string][number]
  type SemesterCourses = Record<string, SemesterCourseInfo>
  type AllTimeCourses = z.infer<typeof allTimeCoursesSchema>
  type GeneralInfo = z.infer<typeof generalInfoSchema>
  type SemesterPlans = z.infer<typeof semesterPlansSchema>
  type AllTimeBiddingInfo = z.infer<typeof biddingSchema>
  type SemesterCoursesPrerequisiteCourses = Prerequisites
}
