import { stringArraySchema } from "./schemas"
import { Autocomplete, Button, Loader, MantineProvider, Select } from "@mantine/core"
import { useColorScheme } from "@mantine/hooks"
import { ModalsProvider } from "@mantine/modals"
import { Notifications } from "@mantine/notifications"
import { useEffect } from "react"
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
import { useLocalStorage } from "./hooks"
import { visibleTabs } from "./tabs"
import { useDibIt } from "./models"
import { sumHours } from "./utilities"
import { filterSearchOptions } from "./search"
import { useCatalog } from "./useCatalog"
import { selectedCatalogConflicts } from "./catalog"

const App = () => {
  const colorScheme = useColorScheme()
  const [dibIt, setDibIt] = useDibIt()
  const [hiddenTabs, setHiddenTabs] = useLocalStorage({
    key: "Hidden Tabs", schema: stringArraySchema,
    defaultValue: [],
  })
  const { courses, ready: catalogReady, failed: loadError, retry: retryCatalog, attempt: retry } = useCatalog(dibIt.semester, dibIt.customCourses, true)

  const conflicts = selectedCatalogConflicts(dibIt.courses?.[dibIt.semester ?? ""] ?? [], courses)
  const hours = sumHours(courses, dibIt)

  const shownTabs = visibleTabs(hiddenTabs)
  const tab = shownTabs.find(({ id }) => id === dibIt.tab)?.id ?? shownTabs[0]!.id

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
                      {loadError ? <Button mt="sm" onClick={retryCatalog}>ניסיון נוסף</Button> : <Loader mt="sm" />}
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
