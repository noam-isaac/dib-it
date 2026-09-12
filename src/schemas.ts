import { z } from "zod"

// TAU Tools fields are optional when the scraper has no information.
interface Prerequisites {
  kind?: "any" | "all" | undefined
  courses?: (string | Prerequisites)[] | undefined
  parallel?: Prerequisites | undefined
}
const prerequisitesSchema: z.ZodType<Prerequisites> = z.lazy(() =>
  z.looseObject({
    kind: z.enum(["any", "all"]).optional(),
    courses: z.array(z.union([z.string(), prerequisitesSchema])).optional(),
    parallel: prerequisitesSchema.optional(),
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
const courseSchema = z.looseObject({
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
          maximal: bidSchema,
          minimal: bidSchema,
          wanted: z.number(),
          received: z.number(),
          run_available: z.number(),
          total_available: z.number(),
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
export const dibItCourseSchema = z.strictObject({
  id: z.string().min(1),
  groups: z.array(z.string()).optional(),
  color: z.string().optional(),
  studyPlanCategory: z.string().optional(),
})
export const dibItSchema = z
  .object({
    courses: z.record(z.string(), z.array(dibItCourseSchema)).optional(),
    tab: z.string().optional(),
    semester: z.string().optional(),
    openedPracticeCourses: z.array(z.string()).optional(),
    practicedExams: z.record(z.string(), z.array(z.string())).optional(),
    school: z.string().optional(),
    studyPlan: z.string().optional(),
    degreeStartYear: z.string().optional(),
    theme: z.string().optional(),
    customCourses: z.record(z.string(), semesterCoursesSchema).optional(),
  })
  .strict()
export const facultyPointsSchema = z.array(
  z.object({
    faculty: z.string(),
    points: z.number().nonnegative().optional(),
  }),
)
export const possibleFacultiesSchema = z.record(z.string(), z.array(z.string()))
export const booleanSchema = z.boolean()
export type DibIt = z.infer<typeof dibItSchema>
export type DibItCourse = z.infer<typeof dibItCourseSchema>
export type Grades = z.infer<typeof gradesSchema>
export type FacultyPoints = z.infer<typeof facultyPointsSchema>

// Preserve the existing shared TAU type names, inferred from runtime schemas.
declare global {
  type SemesterCourses = z.infer<typeof semesterCoursesSchema>
  type AllTimeCourses = z.infer<typeof allTimeCoursesSchema>
  type GeneralInfo = z.infer<typeof generalInfoSchema>
  type SemesterPlans = z.infer<typeof semesterPlansSchema>
  type AllTimeBiddingInfo = z.infer<typeof biddingSchema>
  type SemesterCoursesPrerequisiteCourses = Prerequisites
}
