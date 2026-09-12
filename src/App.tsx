import { Autocomplete, Button, Loader, MantineProvider, Select } from "@mantine/core"
import { useColorScheme } from "@mantine/hooks"
import { ModalsProvider } from "@mantine/modals"
import { Notifications } from "@mantine/notifications"
import { useEffect, useMemo, useState } from "react"
import CourseInfoContext from "./CourseInfoContext"
import Exams from "./components/Exams"
import Footer from "./components/Footer"
import Guide from "./components/Guide"
import Header from "./components/Header"
import Practice from "./components/Practice"
import Schedule from "./components/Schedule"
import Settings from "./components/Settings"
import Sidebar from "./components/Sidebar"
import GoogleScheduleSync from "./components/GoogleScheduleSync"
import StudyPlan from "./components/StudyPlan"
import { cachedFetch, useLocalStorage } from "./hooks"
import { visibleTabs } from "./tabs"
import { refreshAnnualClassification, cacheSemesterCourses, getDibIt, useDibIt } from "./models"
import { sumHours } from "./utilities"
import { filterSearchOptions } from "./search"
import { lautmanCourses } from "./lautmanCourses"
import { assertCourseCatalog, importSemesterCourses, selectedCatalogConflicts, type CatalogCourses } from "./catalog"

const startDateString = `date=${encodeURIComponent(new Date().toDateString())}`

const App = () => {
  const colorScheme = useColorScheme()
  const [dibIt, setDibIt] = useDibIt()
  const [hiddenTabs, setHiddenTabs] = useLocalStorage<string[]>({
    key: "Hidden Tabs",
    defaultValue: [],
  })
  const [catalog, setCatalog] = useState<{ semester: string; courses: CatalogCourses } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const catalogReady = catalog !== null && catalog.semester === dibIt.semester
  const courses = useMemo<CatalogCourses>(
    () => ({
      ...(catalog?.semester === dibIt.semester ? catalog?.courses : {}),
      ...(dibIt.semester ? importSemesterCourses(dibIt.semester,
        Object.fromEntries(Object.values(dibIt.customCourses ?? {}).flatMap(Object.entries))) : {}),
    }),
    [catalog, dibIt.semester, dibIt.customCourses],
  )

  const conflicts = selectedCatalogConflicts(dibIt.courses?.[dibIt.semester ?? ""] ?? [], courses)
  const hours = sumHours(courses, dibIt)

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    const semester = dibIt.semester
    const load = async () => {
      if (!semester) {
        const info = await cachedFetch<GeneralInfo>("https://arazim-project.com/data/info.json")
        if (!info.currentSemester) throw new Error("Missing current semester")
        if (!cancelled) setDibIt({ ...getDibIt(), semester: info.currentSemester })
        return
      }
      const result = await cachedFetch<SemesterCourses>(
        `https://arazim-project.com/data/courses-${semester}.json?${startDateString}`, assertCourseCatalog,
      )
      if (cancelled) return
      setCatalog({ semester, courses: cacheSemesterCourses(semester, { ...result, ...lautmanCourses }) })
      const otherSemester = semester.slice(0, 4) + (semester.endsWith("a") ? "b" : "a")
      void cachedFetch<SemesterCourses>(
        `https://arazim-project.com/data/courses-${otherSemester}.json?${startDateString}`, assertCourseCatalog,
      ).then(other => cacheSemesterCourses(otherSemester, other)).catch(() => {})
    }
    void load().catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [dibIt.semester, retry])

  useEffect(() => {
    void refreshAnnualClassification().catch(() => {})
  }, [])

  const shownTabs = visibleTabs(hiddenTabs)
  const tab = shownTabs.find(({ id }) => id === dibIt.tab)?.id ?? shownTabs[0].id

  useEffect(() => {
    if (dibIt.tab && dibIt.tab !== tab) setDibIt({ ...dibIt, tab })
  }, [dibIt.tab, tab])

  return (
    <MantineProvider
      forceColorScheme={colorScheme}
      theme={{
        primaryColor: "cyan",
        components: {
          Select: Select.extend({ defaultProps: { filter: filterSearchOptions } }),
          Autocomplete: Autocomplete.extend({ defaultProps: { filter: filterSearchOptions } }),
        },
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
      }}
    >
      <ModalsProvider>
        <Notifications zIndex={100001} />

        <CourseInfoContext.Provider value={courses}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              width: "100%",
              alignItems: "center",
            }}
          >
            <Header />
            <GoogleScheduleSync />
            <div
                id="main"
                style={{
                  flexGrow: 1,
                  overflowY: "auto",
                  display: "flex",
                  width: "calc(100% - 20px)",
                }}
              >
                <Sidebar key={`${dibIt.activePlanId}:${dibIt.semester}:${retry}`} catalogReady={catalogReady} />
                <div id="content">
                  <div
                    className="adaptive-flex"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginBottom: 5,
                    }}
                  >
                    <Button.Group
                      style={{ maxWidth: "100%", overflow: "auto" }}
                    >
                      {shownTabs.map(({ id, label, icon }) => (
                        <Button
                          key={id}
                          flex="none"
                          className="dont-print"
                          size="md"
                          variant={tab === id ? "light" : "subtle"}
                          leftSection={<i className={`fa-solid fa-${icon}`} aria-hidden="true" />}
                          onClick={() => setDibIt({ ...dibIt, tab: id })}
                        >
                          {label}
                        </Button>
                      ))}
                    </Button.Group>
                    <div style={{ flexGrow: 1 }} />
                    <p style={{ fontSize: 22 }}>שעות: {catalogReady ? hours : "—"}{catalogReady && conflicts.length > 0 && " (חלקי)"}</p>
                  </div>
                  {!catalogReady ? (
                    <div role={loadError ? "alert" : "status"} style={{ padding: 20 }}>
                      <p>{loadError ? "לא ניתן לטעון את נתוני הסמסטר. המערכות שלכם נשמרו במכשיר." : "טוען את הקורסים של הסמסטר..."}</p>
                      {loadError ? <Button mt="sm" onClick={() => setRetry(value => value + 1)}>ניסיון נוסף</Button> : <Loader mt="sm" />}
                    </div>
                  ) : <div key={dibIt.activePlanId}>
                    {tab === "schedule" && <Schedule />}
                    {tab === "exams" && <Exams key={dibIt.semester} />}
                    {tab === "study-plan" && <StudyPlan />}
                    {tab === "settings" && (
                      <Settings hiddenTabs={hiddenTabs} onHiddenTabsChange={setHiddenTabs} />
                    )}
                    {tab === "guide" && <Guide />}
                    {tab === "practice" && <Practice />}
                  </div>}
                </div>
            </div>

            <Footer />
          </div>
        </CourseInfoContext.Provider>
      </ModalsProvider>
    </MantineProvider>
  )
}

export default App
