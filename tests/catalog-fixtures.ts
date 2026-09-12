import { importSemesterCourses } from "../src/catalog"

/** Import raw semester fixtures through the same boundary as downloaded catalogs. */
export const importCatalogs = (sources: Record<string, SemesterCourses>) =>
  Object.fromEntries(Object.entries(sources).map(([semester, source]) => [semester,
    importSemesterCourses(semester, Object.fromEntries(Object.entries(source).filter(([, course]) => course !== undefined))),
  ]))
