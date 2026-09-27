import { expect, test } from "bun:test"
import { ESLint } from "eslint"

test("UI cannot bypass catalog loading or shared exam selectors", async () => {
  const eslint = new ESLint()
  const [result] = await eslint.lintText(`
    import { importSemesterCourses } from "../catalog"
    import { loadSemesterCourses } from "../catalogData"
    import { refreshAnnualFeed } from "../annualRegistry"
    export const bypass = (semester: string) => {
      fetch(\`/data/courses-\${semester}.json\`)
      fetch("/data/courses-2026a.json")
      loadSemesterCourses(semester)
      refreshAnnualFeed()
      const course = importSemesterCourses(semester, {}).course
      return [course?.examData, course?.groupExamData, course?.exams]
    }
  `, { filePath: "src/components/ExamSearch.tsx" })
  expect(result!.messages.filter(message => message.fatal)).toEqual([])
  expect(result!.messages.filter(message => message.ruleId === "no-restricted-imports")).toHaveLength(3)
  expect(result!.messages.filter(message => message.ruleId === "no-restricted-syntax")).toHaveLength(5)

  const [allowed] = await eslint.lintText(`
    import { useCatalog } from "../useCatalog"
    import { collectExams } from "../exams"
    export function ExamSearch() {
      const { courses } = useCatalog("2026a")
      return collectExams(Object.keys(courses).map(id => ({ id })), courses, "catalog")
    }
  `, { filePath: "src/components/ExamSearch.tsx" })
  expect(allowed!.messages).toEqual([])
})
