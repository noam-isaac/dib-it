import { Button, MantineProvider } from "@mantine/core"
import { useColorScheme } from "@mantine/hooks"
import React, { useState } from "react"
import ReactDOM from "react-dom/client"
import { ErrorBoundary, FallbackProps } from "react-error-boundary"
import App from "./App.tsx"

import "./index.css"
import "@fortawesome/fontawesome-free/css/all.min.css"
import "@mantine/core/styles.css"
import "@mantine/dates/styles.css"
import "@mantine/notifications/styles.css"
import "@mantine/dropzone/styles.css"

import { legacyWorkspaceKeys, MIGRATION_RECOVERY_KEY, recoveryData, resetPreferences, resetWorkspace } from "./preferences.ts"
import { downloadBlob } from "./utilities.ts"

// Only obsolete fetched caches are disposable at startup. Workspace migration is read-only
// until an actual save commits the version and preserves its original source.
let startupError: unknown
try {
  Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => key !== null && key.startsWith("Cached Courses for"))
    .forEach(key => localStorage.removeItem(key))
} catch (error) { startupError = error }
const InitializedApp = () => {
  if (startupError) throw startupError
  return <App />
}

const ErrorFallback: React.FC<FallbackProps> = ({ error }) => {
  const colorScheme = useColorScheme()
  const [actionError, setActionError] = useState("")
  // An optional legacy-data notice must not hide recovery when storage is denied.
  const hasLegacyData = (() => {
    try { return legacyWorkspaceKeys().length > 0 || localStorage.getItem(MIGRATION_RECOVERY_KEY) !== null }
    catch { return false }
  })()

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
        <Button variant="default" onClick={() => {
          try {
            downloadBlob("dibit-recovery.json", new Blob([recoveryData()], { type: "application/json" }))
            setActionError("")
          } catch {
            setActionError("לא ניתן להוריד את נתוני השחזור כרגע. בדקו שהדפדפן מאפשר גישה לנתוני האתר ונסו שוב לפני איפוס.")
          }
        }}>הורדת הנתונים לפני איפוס</Button>
        {actionError && <p role="alert" style={{ color: "var(--mantine-color-red-text)" }}>{actionError}</p>}
        {hasLegacyData && <p style={{ fontSize: 14 }}>
          נמצאו נתונים מהגרסה הישנה או עותק שנשמר לפני שדרוג. קובץ השחזור כולל את ערכי המקור לצורך תיקון,
          ואינו גיבוי רגיל לשחזור אוטומטי.
        </p>}
        <Button
          my={10}
          leftSection={<i className="fa-solid fa-wrench" aria-hidden="true" />}
          onClick={() => {
            if (resetPreferences()) window.location.reload()
            else setActionError("איפוס העדפות התצוגה לא הושלם. חלק מההעדפות עשויות כבר להיות מאופסות. בדקו שהדפדפן מאפשר גישה לנתוני האתר ונסו שוב.")
          }}
        >
          איפוס העדפות התצוגה
        </Button>
        <p style={{ fontSize: 14, opacity: 0.8, margin: 0 }}>
          מומלץ להתחיל מכאן: הפעולה מאפסת רק העדפות תצוגה ואינה נוגעת במערכות השעות.
        </p>
        <Button
          my={10}
          color="red"
          variant="light"
          leftSection={<i className="fa-solid fa-trash" aria-hidden="true" />}
          onClick={() => {
            if (!window.confirm("למחוק את מערכות השעות מהמכשיר? הורידו קודם עותק של הנתונים. הסנכרון האוטומטי יכובה; הגיבוי בגוגל לא יימחק.")) return
            try {
              resetWorkspace()
              window.location.reload()
            } catch {
              setActionError("איפוס המערכות לא הושלם. ייתכן שחלק מהנתונים כבר נמחקו. הורידו את הנתונים שנותרו לפני ניסיון נוסף.")
            }
          }}
        >
          איפוס המערכות במכשיר
        </Button>
        <p>
          אפשר לדווח על התקלה במאגר של דיביט של נועם{" "}
          <a className="link handle text-accent" href="https://github.com/noam-isaac/dib-it/issues">
            כאן
          </a>{" "}
          ולצרף תיאור של השגיאה.
        </p>
        {error instanceof Error && error.message && (
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
      <InitializedApp />
    </ErrorBoundary>
  </React.StrictMode>
)
