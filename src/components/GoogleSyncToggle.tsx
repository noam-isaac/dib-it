import { booleanSchema } from "../schemas"
import { Group, Menu, Text, Tooltip } from "@mantine/core"
import { useAuthState } from "react-firebase-hooks/auth"
import { auth, firestore } from "../firebase"
import { useLocalStorage } from "../hooks"

const EnabledGoogleSyncToggle = () => {
  const [currentUser] = useAuthState(auth!)
  const [automatic, setAutomatic] = useLocalStorage({
    key: "Automatic Google Sync",
    schema: booleanSchema,
    defaultValue: false,
  })
  if (!currentUser) return null

  return (
    <Tooltip label="אותן מערכות בכל המכשירים, כולל מחיקות. לשמירת גרסה קודמת, השתמשו בגיבוי לקובץ.">
      <Menu.Item
        renderRoot={(props) => (
          <button {...props} role="menuitemcheckbox" aria-checked={automatic} />
        )}
        closeMenuOnClick={false}
        leftSection={<i className="fa-solid fa-cloud" aria-hidden="true" />}
        rightSection={
          <Group gap={6} wrap="nowrap" aria-hidden="true">
            <Text size="xs" fw={600} c={automatic ? "cyan" : "dimmed"}>
              {automatic ? "מופעל" : "כבוי"}
            </Text>
            <i
              className={`fa-solid fa-toggle-${automatic ? "on" : "off"}`}
              style={{ fontSize: 20 }}
            />
          </Group>
        }
        onClick={() => setAutomatic((value) => !value)}
      >
        סנכרון אוטומטי עם גוגל
      </Menu.Item>
    </Tooltip>
  )
}

const GoogleSyncToggle = () =>
  auth && firestore ? <EnabledGoogleSyncToggle /> : null
export default GoogleSyncToggle
