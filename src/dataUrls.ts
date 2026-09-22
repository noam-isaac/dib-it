// Browser data paths belong here; the upstream host belongs in vercel.json.
const DATA_BASE_URL = "/data/"
export const dataUrls = {
  info: `${DATA_BASE_URL}info.json`,
  courses: `${DATA_BASE_URL}courses.json`,
  grades: `${DATA_BASE_URL}grades.json`,
  bidding: `${DATA_BASE_URL}bidding.json`,
  semesterCourses: (semester: string) => `${DATA_BASE_URL}courses-${semester}.json`,
  plans: (year: string) => `${DATA_BASE_URL}plans-${year}.json`,
  // Legacy annual feed; generation still needs migrating to TAU Tools.
  annual: "https://raw.githubusercontent.com/noam-isaac/dib-it/annual-data/annual-groups.json",
}
