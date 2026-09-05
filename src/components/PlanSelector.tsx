import { ActionIcon, Button, Group, Menu, Select, Stack, Text, TextInput } from "@mantine/core"
import { modals } from "@mantine/modals"
import { useState } from "react"
import { getWorkspace, setWorkspace, useWorkspace } from "../models"
import { addPlan, deletePlan, renamePlan } from "../plans"

const PlanNameForm = ({ initialName, onSave }: { initialName: string; onSave: (name: string) => void }) => {
  const [name, setName] = useState(initialName)
  return (
    <form onSubmit={event => {
      event.preventDefault()
      if (name.trim()) onSave(name.trim())
    }}>
      <Stack>
        <TextInput label="שם התוכנית" value={name} onChange={event => setName(event.currentTarget.value)} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={() => modals.closeAll()}>ביטול</Button>
          <Button type="submit" disabled={!name.trim()}>שמירה</Button>
        </Group>
      </Stack>
    </form>
  )
}

const PlanSelector = () => {
  const [workspace] = useWorkspace()
  const active = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  const edit = (action: "create" | "duplicate" | "rename") => {
    modals.open({
      title: action === "create" ? "תוכנית חדשה" : action === "duplicate" ? "שכפול תוכנית" : "שינוי שם התוכנית",
      centered: true,
      children: <PlanNameForm
        initialName={action === "create" ? "" : action === "duplicate" ? `${active.name} — עותק` : active.name}
        onSave={name => {
          const latest = getWorkspace()
          setWorkspace(action === "rename" ? renamePlan(latest, active.id, name) : addPlan(latest, name, action === "duplicate"))
          modals.closeAll()
        }}
      />,
    })
  }
  return (
    <div style={{ marginBottom: 10 }}>
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <Select
          label="תוכנית שמורה"
          style={{ flex: 1, minWidth: 0 }}
          value={active.id}
          allowDeselect={false}
          data={workspace.plans.map(plan => ({ value: plan.id, label: plan.name }))}
          onChange={id => {
            const latest = getWorkspace()
            if (id && latest.plans.some(plan => plan.id === id)) setWorkspace({ ...latest, activePlanId: id })
          }}
        />
        <Button variant="light" onClick={() => edit("create")} leftSection={<i className="fa-solid fa-plus" />}>חדשה</Button>
        <Menu>
          <Menu.Target>
            <ActionIcon size="lg" variant="light" aria-label="ניהול תוכניות"><i className="fa-solid fa-ellipsis-vertical" /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => edit("duplicate")} leftSection={<i className="fa-solid fa-copy" />}>שכפול התוכנית</Menu.Item>
            <Menu.Item onClick={() => edit("rename")} leftSection={<i className="fa-solid fa-pen" />}>שינוי שם</Menu.Item>
            <Menu.Item color="red" disabled={workspace.plans.length <= 1} leftSection={<i className="fa-solid fa-trash" />} onClick={() => modals.openConfirmModal({
              title: "מחיקת תוכנית",
              centered: true,
              children: <Text>למחוק את ״{active.name}״ ואת בחירות הקורסים שלה בכל הסמסטרים? התוכניות האחרות יישמרו.</Text>,
              labels: { confirm: "מחיקת התוכנית", cancel: "ביטול" },
              confirmProps: { color: "red" },
              onConfirm: () => setWorkspace(deletePlan(getWorkspace(), active.id)),
            })}>מחיקת התוכנית</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>הבחירות נשמרות אוטומטית בתוכנית זו בכל הסמסטרים.</Text>
    </div>
  )
}

export default PlanSelector
