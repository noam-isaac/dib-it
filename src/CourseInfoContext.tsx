import type { CatalogCourses } from "./catalog"
/** A context to store the information about all of the courses of the current semester */

import { createContext, useContext } from "react"

const CourseInfoContext = createContext<CatalogCourses>({})

export const useCourseInfo = (): CatalogCourses => {
  return useContext(CourseInfoContext)
}

export default CourseInfoContext
