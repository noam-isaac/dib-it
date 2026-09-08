import { Button, Select, Switch } from "@mantine/core"
import { useLocalStorage } from "../hooks"
import { useState } from "react"
import { annualYear } from "../annualRegistry"
import { refreshAnnualClassification, getDibIt, useDibIt } from "../models"
import { isScheduleBackup } from "../scheduleBackup"
import { notifications } from "@mantine/notifications"
import { Dropzone } from "@mantine/dropzone"
import { tabs } from "../tabs"

const Settings = ({ hiddenTabs, onHiddenTabsChange }: {
  hiddenTabs: string[]
  onHiddenTabsChange: (tabs: string[]) => void
}) => {
  const [dibIt, setDibIt] = useDibIt()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const classification = annualYear(dibIt.semester?.slice(0, 4) ?? "")
  const [compactView, setCompactView] = useLocalStorage<boolean>({
    key: "Compact View",
    defaultValue: false,
  })

  return (
    <div style={{ maxWidth: 600, marginBottom: 20 }}>
      <p>נתוני קורסים שנתיים</p>
      <p>{classification ? `אומתו לאחרונה: ${classification.verifiedAt}` : "נתוני השנה עדיין אינם זמינים. השינויים נשמרים עד לטעינתם."}</p>
      <Button variant="subtle" loading={refreshing} onClick={async () => {
        setRefreshing(true); setRefreshFailed(false)
        try { await refreshAnnualClassification() }
        catch { setRefreshFailed(true) }
        finally { setRefreshing(false) }
      }}>רענון נתוני קורסים שנתיים</Button>
      {refreshFailed && <p role="alert">הרענון נכשל. הנתונים האחרונים והבחירות שלכם נשמרו.</p>}
      <p>לשוניות מוצגות</p>
      {tabs.filter(({ id }) => id !== "settings").map(({ id, label }) => (
        <Switch
          key={id}
          mb="xs"
          label={label}
          checked={!hiddenTabs.includes(id)}
          onChange={(event) => onHiddenTabsChange(event.currentTarget.checked
            ? hiddenTabs.filter((tab) => tab !== id)
            : [...hiddenTabs, id])}
        />
      ))}
      <p>תצוגת מערכת</p>
      <Switch
        label={compactView ? "קומפקטי" : "רחב"}
        checked={compactView}
        onChange={(e) => setCompactView(e.currentTarget.checked)}
      />
      <Select
        mt="xs"
        label="עיצוב"
        leftSection={<i className="fa-solid fa-palette" />}
        data={[
          { label: "גוגל", value: "google" },
          { label: "אפל", value: "apple" },
        ]}
        value={dibIt.theme ?? "apple"}
        onChange={(v) => {
          dibIt.theme = v ?? "apple"
          setDibIt({ ...dibIt })
        }}
      />
      <Dropzone
        onDrop={async (files) => {
          try {
            const customCourses = Object.fromEntries(await Promise.all(files.map(async file =>
              [file.name, JSON.parse(await file.text())],
            )))
            if (!isScheduleBackup({ customCourses })) throw new Error("קובץ הקורסים אינו תקין.")
            const latest = getDibIt()
            setDibIt({ ...latest, customCourses: { ...latest.customCourses, ...customCourses } })
          } catch (error) {
            notifications.show({ title: "ייבוא הקורסים נכשל", message: error instanceof Error ? error.message : "לא ניתן לקרוא את הקובץ.", color: "red" })
          }
        }}
        my="xs"
        accept={["application/json"]}
      >
        <p>
          <i
            className="fa-solid fa-file-lines"
            style={{ marginInlineEnd: 10 }}
          />
          גררו לכאן קובץ של קורסים מיוחדים שלכם או לחצו...
        </p>
      </Dropzone>
      {Object.keys(dibIt.customCourses ?? {}).map((filename) => (
        <Button
          color="red"
          key={filename}
          mb={5}
          ml={5}
          rightSection={<i className="fa-solid fa-trash" />}
          onClick={() => {
            delete dibIt.customCourses![filename]
            setDibIt({ ...dibIt })
          }}
        >
          {filename}
        </Button>
      ))}
    </div>
  )
}

export default Settings
