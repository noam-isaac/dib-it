import { Button, MantineProvider } from "@mantine/core"
import { useColorScheme } from "@mantine/hooks"
import React from "react"
import ReactDOM from "react-dom/client"
import { ErrorBoundary, FallbackProps } from "react-error-boundary"
import App from "./App.tsx"

import "./index.css"
import "@fortawesome/fontawesome-free/css/all.min.css"
import "@mantine/core/styles.css"
import "@mantine/dates/styles.css"
import "@mantine/notifications/styles.css"
import "@mantine/dropzone/styles.css"

import { notifications } from "@mantine/notifications"
import { getLocalStorage } from "./hooks.ts"
import { DibIt, DibItCourse, setDibIt } from "./models.ts"
import { downloadBlob } from "./utilities.ts"

const handleDeprecation = () => {
  // Remove "Cached Courses for {semester}", they weigh too much to be in local storage.
  const keysToRemove = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) {
      continue
    }

    if (key.startsWith("Cached Courses for")) {
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key)
  }

  if (localStorage.getItem("Dib It")) return

  const data: Record<string, any> = {}

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (
      k.startsWith("Courses") ||
      k.startsWith("Groups") ||
      k.startsWith("Colors") ||
      k.includes("Dib It Serialize") ||
      k === "Semester"
    ) {
      data[k] = getLocalStorage(k)
    }
  }

  if (Object.keys(data).some((x) => x.startsWith("Courses"))) {
    const result: DibIt = {}
    let semester = ""
    if (data["Semester"]) {
      semester = result.semester = data["Semester"]
      delete data["Semester"]
    }
    if (data["Courses"]) {
      data[`Courses ${semester}`] = data["Courses"]
      delete data["Courses"]
    }
    if (data["Groups"]) {
      data[`Groups ${semester}`] = data["Groups"]
      delete data["Groups"]
    }
    if (data["Colors"]) {
      data[`Colors ${semester}`] = data["Colors"]
      delete data["Colors"]
    }
    if (data["School (Dib It Serialize)"]) {
      result.school = data["School (Dib It Serialize)"]
    }
    if (data["Study Plan (Dib It Serialize)"]) {
      result.studyPlan = data["Study Plan (Dib It Serialize)"]
    }

    const keys = Object.keys(data).sort()
    for (const key of keys) {
      if (key.startsWith("Courses")) {
        const semester = key.split(" ")[1]
        const courses = data[key]
        const groupsKey = `Groups ${semester}`
        let groups: any = {}
        if (data[groupsKey]) {
          groups = data[groupsKey]
        }
        const colorsKey = `Colors ${semester}`
        let colors: any = {}
        if (data[colorsKey]) {
          colors = data[colorsKey]
        }

        if (!result.courses) {
          result.courses = {}
        }

        if (!result.courses[semester]) {
          result.courses[semester] = []
        }

        for (const course of courses) {
          const courseDict: DibItCourse = { id: course }
          result.courses[semester].push(courseDict)
          if (groups[course]) {
            courseDict.groups = groups[course]
          }
          if (colors[course]) {
            courseDict.color = colors[course]
          }
        }
      }
    }

    setDibIt({ ...result })
    for (const key of Object.keys(data)) localStorage.removeItem(key)
    for (const key of ["Semester", "Courses", "Groups", "Colors"]) localStorage.removeItem(key)
    notifications.show({
      title: "עדכון ה-Dib It בוצע בהצלחה",
      message:
        "המערכת שלכם שודרגה לפורמט חדש ותתאים לפיצ׳רים חדשים שאנחנו עובדים עליהם!",
      style: { direction: "rtl" },
      icon: <i className="fa-solid fa-check" />,
      color: "green",
    })
  }
}

handleDeprecation()

const ErrorFallback: React.FC<FallbackProps> = ({ error }) => {
  const colorScheme = useColorScheme()

  return (
    <MantineProvider
      forceColorScheme={colorScheme}
      theme={{
        primaryColor: "cyan",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          minHeight: "100%",
          width: "100%",
          maxWidth: 520,
          margin: "0 auto",
          padding: 20,
          boxSizing: "border-box",
          textAlign: "center",
          overflowWrap: "anywhere",
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>לא ניתן להציג את המערכת</h1>
        <p>
          לצערנו אירעה שגיאה באתר. נסו לטעון מחדש. לפני איפוס, הורידו עותק של הנתונים לשחזור.
        </p>
        <Button my={10} onClick={() => window.location.reload()}>טעינה מחדש</Button>
        <Button variant="default" onClick={() => downloadBlob("dibit-recovery.json", new Blob([
          localStorage.getItem("Dib It") ?? "{}",
        ], { type: "application/json" }))}>הורדת הנתונים לפני איפוס</Button>
        <Button
          my={10}
          color="red"
          leftSection={<i className="fa-solid fa-wrench" aria-hidden="true" />}
          onClick={() => {
            if (!window.confirm("למחוק את מערכות השעות מהמכשיר? הורידו קודם עותק של הנתונים. הפעולה אינה מוחקת את הגיבוי בגוגל.")) return
            localStorage.removeItem("Dib It")
            localStorage.removeItem("Dib It Sync")
            localStorage.removeItem("Hidden Tabs")
            window.location.reload()
          }}
        >
          איפוס המערכות במכשיר
        </Button>
        <p>
          אפשר לדווח על התקלה במאגר הפורק של נועם{" "}
          <a className="link handle text-accent" href="https://github.com/noam-isaac/dib-it/issues">
            כאן
          </a>{" "}
          ולצרף תיאור של השגיאה.
        </p>
        {error?.message && (
          <details style={{ width: "100%", marginTop: 16 }}>
            <summary style={{ cursor: "pointer" }}>פרטים טכניים</summary>
            <pre dir="ltr" style={{ whiteSpace: "pre-wrap", textAlign: "start", fontSize: 12 }}>{error.message}</pre>
          </details>
        )}
      </div>
    </MantineProvider>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
