import { biddingSchema, type FacultyPoints } from "./schemas"
import { cachedFetch } from "./hooks"
import { DibItCourse } from "./models"

export const getPossibleFaculties = async (
  courses: DibItCourse[],
  facultyPoints: FacultyPoints,
  bidding?: AllTimeBiddingInfo
) => {
  bidding ??= await cachedFetch(
    "https://arazim-project.com/data/bidding.json", biddingSchema
  )

  const facultyPointsMap: Record<string, number> = {}
  for (const { faculty, points } of facultyPoints) {
    if (points) {
      facultyPointsMap[faculty] = points
    }
  }

  const possibleFaculties: Record<string, string[]> = {}

  for (const course of courses) {
    const faculties = new Set<string>()
    for (const semester of Object.values(bidding[course.id] ?? {})) {
      for (const group of Object.values(semester)) {
        for (const statistics of group) {
          if (statistics.faculty) {
            faculties.add(statistics.faculty)
          }
        }
      }
    }

    const addAll = !Object.keys(facultyPointsMap).some((faculty) =>
      faculties.has(faculty)
    )
    for (const faculty in facultyPointsMap) {
      if (addAll || faculties.has(faculty)) {
        if (!possibleFaculties[course.id]) {
          possibleFaculties[course.id] = []
        }
        (possibleFaculties[course.id] ??= []).push(faculty)
      }
    }
  }

  return possibleFaculties
}

const autoBid = async (
  courses: DibItCourse[],
  facultyPoints: FacultyPoints,
  possibleFaculties: Record<string, string[]>,
  bidding?: AllTimeBiddingInfo
) => {
  bidding ??= await cachedFetch(
    "https://arazim-project.com/data/bidding.json", biddingSchema
  )

  const facultyPointsMap: Record<string, number> = {}
  for (const { faculty, points } of facultyPoints) {
    if (points) {
      facultyPointsMap[faculty] = points
    }
  }

  const result: Record<string, Record<string, number>> = {}
  for (const faculty in facultyPointsMap) {
    result[faculty] = {}
  }

  // Calculate mean costs for a course in every possible faculty. The cost would be the average minimal cost, plus one.
  const courseFacultyCosts: Record<string, Record<string, number>> = {}
  for (const course of courses) {
    const facultySums: Record<string, number> = {}
    const facultyCounts: Record<string, number> = {}

    for (const semester of Object.values(bidding[course.id] ?? {})) {
      for (const group of Object.values(semester)) {
        for (const statistics of group) {
          if (statistics.minimal === null) continue
          // Unknown faculty, add to all.
          if (!statistics.faculty || !facultyPointsMap[statistics.faculty]) {
            for (const faculty of possibleFaculties[course.id] ?? []) {
              facultySums[faculty] =
                (facultySums[faculty] ?? 0) + statistics.minimal
              facultyCounts[faculty] = (facultyCounts[faculty] ?? 0) + 1
            }
          } else {
            facultySums[statistics.faculty] =
              (facultySums[statistics.faculty] ?? 0) + statistics.minimal
            facultyCounts[statistics.faculty] =
              (facultyCounts[statistics.faculty] ?? 0) + 1
          }
        }
      }
    }

    for (const [faculty, sum] of Object.entries(facultySums)) {
      const count = facultyCounts[faculty]
      if (!count) continue
      facultySums[faculty] =
        Math.ceil(sum / count) + 1
    }

    courseFacultyCosts[course.id] = facultySums
  }

  // Assign courses that can only be assigned to one faculty.
  const currentFacultyPoints: Record<string, number> = {}
  for (const faculty in facultyPointsMap) {
    currentFacultyPoints[faculty] = 0
  }

  for (const [course, costs] of Object.entries(courseFacultyCosts)) {
    const faculties = Object.keys(costs)
    if (faculties.length === 1) {
      const faculty = faculties[0]
      if (faculty === undefined) continue
      const cost = costs[faculty], bids = result[faculty]
      if (cost === undefined || bids === undefined) continue
      bids[course] = cost
      currentFacultyPoints[faculty] = (currentFacultyPoints[faculty] ?? 0) + cost
    }
  }

  // Assign remaining courses to the faculty with the most remaining points.
  for (const [course, costs] of Object.entries(courseFacultyCosts)) {
    const faculties = Object.keys(costs)
    if (faculties.length > 1) {
      const first = faculties[0]
      if (first === undefined) continue
      let bestFaculty = ""
      let bestFacultyRemainingPoints = -1000
      for (const faculty of faculties) {
        const remainingPoints =
          (facultyPointsMap[faculty] ?? 0) -
          (currentFacultyPoints[faculty] ?? 0) -
          (costs[first] ?? 0)
        if (remainingPoints > bestFacultyRemainingPoints) {
          bestFacultyRemainingPoints = remainingPoints
          bestFaculty = faculty
        }
      }
      const cost = costs[bestFaculty], bids = result[bestFaculty]
      if (cost === undefined || bids === undefined) continue
      bids[course] = cost
      currentFacultyPoints[bestFaculty] = (currentFacultyPoints[bestFaculty] ?? 0) + cost
    }
  }

  // Balance the points to match the available points for each faculty.
  for (const [faculty, points] of Object.entries(facultyPointsMap)) {
    const bids = result[faculty]
    if (!bids) continue
    let iterations = 0
    let difference = points - (currentFacultyPoints[faculty] ?? 0)
    const sortedCourses = Object.keys(bids).sort(
      (a, b) => (bids[b] ?? 0) - (bids[a] ?? 0)
    )
    const sortedCoursesReverse = sortedCourses.reverse()

    // Add more points to bids, giving more to higher bids.
    while (difference > 0 && iterations <= 50) {
      for (const course of sortedCourses) {
        const increase = Math.min(
          difference,
          Math.ceil((bids[course] ?? 0) * 0.05) + 1
        )
        bids[course] = (bids[course] ?? 0) + increase
        difference -= increase
      }

      iterations++
    }

    // Reduce points from bids, taking more from lower bids.
    while (difference < 0 && iterations <= 50) {
      for (const course of sortedCoursesReverse) {
        const decrease = Math.min(
          -difference,
          Math.ceil((bids[course] ?? 0) * 0.05) + 1,
          bids[course] ?? 0
        )
        bids[course] = (bids[course] ?? 0) - decrease
        difference += decrease
      }

      iterations++
    }
  }

  return result
}

export default autoBid
