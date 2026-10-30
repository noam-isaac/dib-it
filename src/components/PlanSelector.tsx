import { Button, Group, Select, Stack, Text, TextInput } from "@mantine/core"
import { modals } from "@mantine/modals"
import { useState } from "react"
import { updateWorkspace, useWorkspace } from "../models"
import { addPlan, deletePlan, renamePlan } from "../plans"

const PlanNameForm = ({ initialName, onSave }: { initialName: string; onSave: (name: string) => Promise<unknown> }) => {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return (
    <form onSubmit={async event => {
      event.preventDefault()
      if (!name.trim() || busy) return
      setBusy(true)
      try { await onSave(name.trim()); modals.closeAll() }
      catch (failure) { setError(failure instanceof Error ? failure.message : "השמירה נכשלה.") }
      finally { setBusy(false) }
    }}>
      <Stack>
        <TextInput label="שם מערכת השעות" value={name} onChange={event => setName(event.currentTarget.value)} data-autofocus />
        {error && <Text role="alert" c="red">{error}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => modals.closeAll()}>ביטול</Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>שמירה</Button>
        </Group>
      </Stack>
    </form>
  )
}

const PlanSelector = () => {
  const workspace = useWorkspace()
  const active = workspace.plans.find(plan => plan.id === workspace.activePlanId)!
  const edit = (action: "create" | "duplicate" | "rename") => {
    modals.open({
      title: action === "create" ? "מערכת שעות חדשה" : action === "duplicate" ? "שכפול מערכת שעות" : "שינוי שם מערכת השעות",
      centered: true,
      children: <PlanNameForm
        initialName={action === "create" ? "" : action === "duplicate" ? `${active.name} — עותק` : active.name}
        onSave={name => updateWorkspace(latest => action === "rename" ? renamePlan(latest, active.id, name) : addPlan(latest, name, action === "duplicate"))}
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
        onChange={async id => {
          if (!id) return
          try {
            await updateWorkspace(latest => latest.plans.some(plan => plan.id === id) ? { ...latest, activePlanId: id } : latest)
            modals.closeAll()
          } catch { /* The shared persistence notice explains the failure. */ }
        }}
      />
      <Group gap="xs">
        <Button variant="default" size="sm" onClick={() => edit("create")} leftSection={<i className="fa-solid fa-plus" aria-hidden="true" />}>מערכת שעות חדשה</Button>
        <Button variant="default" size="sm" onClick={() => edit("duplicate")} leftSection={<i className="fa-solid fa-copy" aria-hidden="true" />}>שכפול מערכת השעות</Button>
        <Button variant="default" size="sm" onClick={() => edit("rename")} leftSection={<i className="fa-solid fa-pen" aria-hidden="true" />}>שינוי שם</Button>
        <Button variant="light" size="sm" color="red" disabled={workspace.plans.length <= 1} leftSection={<i className="fa-solid fa-trash" aria-hidden="true" />} onClick={() => modals.openConfirmModal({
          title: "מחיקת מערכת שעות",
          centered: true,
          children: <Text>למחוק את ״{active.name}״ ואת בחירות הקורסים שלה בכל הסמסטרים? מערכות השעות האחרות יישמרו.</Text>,
          labels: { confirm: "מחיקת מערכת השעות", cancel: "ביטול" },
          confirmProps: { color: "red" },
          closeOnConfirm: false,
          onConfirm: async () => {
            try { await updateWorkspace(latest => deletePlan(latest, active.id)); modals.closeAll() }
            catch { /* Keep the confirmation open; the shared notice explains the failure. */ }
          },
        })}>מחיקת מערכת השעות</Button>
      </Group>
    </Stack>
  )
}

export default PlanSelector
