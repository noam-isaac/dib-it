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
        <TextInput label="שם מערכת השעות" value={name} onChange={event => setName(event.currentTarget.value)} data-autofocus />
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
      title: action === "create" ? "מערכת שעות חדשה" : action === "duplicate" ? "שכפול מערכת שעות" : "שינוי שם מערכת השעות",
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
    <Group gap={6} wrap="nowrap" mb={6}>
      <Text component="label" htmlFor="schedule-selector" size="sm" style={{ whiteSpace: "nowrap" }}>מערכת שעות</Text>
      <Select
        id="schedule-selector"
        aria-label="מערכת שעות"
        searchable
        style={{ flex: 1, minWidth: 0 }}
        value={active.id}
        allowDeselect={false}
        data={workspace.plans.map(plan => ({ value: plan.id, label: plan.name }))}
        onChange={id => {
          const latest = getWorkspace()
          if (id && latest.plans.some(plan => plan.id === id)) setWorkspace({ ...latest, activePlanId: id })
        }}
      />
      <Menu>
        <Menu.Target>
          <ActionIcon size="lg" variant="light" aria-label="ניהול מערכות שעות"><i className="fa-solid fa-ellipsis-vertical" /></ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => edit("create")} leftSection={<i className="fa-solid fa-plus" />}>מערכת שעות חדשה</Menu.Item>
          <Menu.Item onClick={() => edit("duplicate")} leftSection={<i className="fa-solid fa-copy" />}>שכפול מערכת השעות</Menu.Item>
          <Menu.Item onClick={() => edit("rename")} leftSection={<i className="fa-solid fa-pen" />}>שינוי שם</Menu.Item>
          <Menu.Item color="red" disabled={workspace.plans.length <= 1} leftSection={<i className="fa-solid fa-trash" />} onClick={() => modals.openConfirmModal({
            title: "מחיקת מערכת שעות",
            centered: true,
            children: <Text>למחוק את ״{active.name}״ ואת בחירות הקורסים שלה בכל הסמסטרים? מערכות השעות האחרות יישמרו.</Text>,
            labels: { confirm: "מחיקת מערכת השעות", cancel: "ביטול" },
            confirmProps: { color: "red" },
            onConfirm: () => setWorkspace(deletePlan(getWorkspace(), active.id)),
          })}>מחיקת מערכת השעות</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}

export default PlanSelector
