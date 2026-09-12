import { semesterCoursesSchema, booleanSchema } from "../schemas"
import { Button, Select, Switch } from "@mantine/core"
import { reportError, useLocalStorage } from "../hooks"
import { useDibIt } from "../models"
import { Dropzone } from "@mantine/dropzone"

const Settings = () => {
  const [dibIt, setDibIt] = useDibIt()
  const [compactView, setCompactView] = useLocalStorage({
    schema: booleanSchema,
    key: "Compact View",
    defaultValue: false,
  })

  return (
    <div style={{ maxWidth: 600, marginBottom: 20 }}>
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
            const entries = await Promise.all(
              files.map(async (file) => {
                const input: unknown = JSON.parse(await file.text())
                return [file.name, semesterCoursesSchema.parse(input)] as const
              }),
            )
            setDibIt((previous) => ({
              ...previous,
              customCourses: {
                ...previous.customCourses,
                ...Object.fromEntries(entries),
              },
            }))
          } catch (error: unknown) {
            reportError(error)
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
            const customCourses = { ...dibIt.customCourses }
            delete customCourses[filename]
            setDibIt({ ...dibIt, customCourses })
          }}
        >
          {filename}
        </Button>
      ))}
    </div>
  )
}

export default Settings
