import { Button, Group, Select, Stack, Text, TextInput } from "@mantine/core"
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
    <Stack>
      <Select
        id="schedule-selector"
        label="מערכת שעות"
        searchable
        comboboxProps={{ withinPortal: false }}
        value={active.id}
        allowDeselect={false}
        data={workspace.plans.map(plan => ({ value: plan.id, label: plan.name }))}
        onChange={id => {
          const latest = getWorkspace()
          if (id && latest.plans.some(plan => plan.id === id)) {
            setWorkspace({ ...latest, activePlanId: id })
            modals.closeAll()
          }
        }}
      />
      <Group gap="xs">
        <Button variant="light" size="sm" onClick={() => edit("create")} leftSection={<i className="fa-solid fa-plus" aria-hidden="true" />}>מערכת שעות חדשה</Button>
        <Button variant="light" size="sm" onClick={() => edit("duplicate")} leftSection={<i className="fa-solid fa-copy" aria-hidden="true" />}>שכפול מערכת השעות</Button>
        <Button variant="light" size="sm" onClick={() => edit("rename")} leftSection={<i className="fa-solid fa-pen" aria-hidden="true" />}>שינוי שם</Button>
        <Button variant="light" size="sm" color="red" disabled={workspace.plans.length <= 1} leftSection={<i className="fa-solid fa-trash" aria-hidden="true" />} onClick={() => modals.openConfirmModal({
          title: "מחיקת מערכת שעות",
          centered: true,
          children: <Text>למחוק את ״{active.name}״ ואת בחירות הקורסים שלה בכל הסמסטרים? מערכות השעות האחרות יישמרו.</Text>,
          labels: { confirm: "מחיקת מערכת השעות", cancel: "ביטול" },
          confirmProps: { color: "red" },
          onConfirm: () => setWorkspace(deletePlan(getWorkspace(), active.id)),
        })}>מחיקת מערכת השעות</Button>
      </Group>
    </Stack>
  )
}

export default PlanSelector
