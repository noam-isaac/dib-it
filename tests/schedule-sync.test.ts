import { expect, test } from "bun:test"
import { normalizePlans } from "../src/plans"
import { readCloudSchedule, scheduleKey, startScheduleSync, syncDecision, withLocalNavigation, type SyncStatus } from "../src/scheduleSync"

const workspace = (id = "one") => normalizePlans({ semester: "2026a", courses: { "2026a": [{ id, groups: ["01"] }] } })
const pause = () => new Promise(resolve => setTimeout(resolve, 10))
const until = async (check: () => boolean) => {
  const deadline = Date.now() + 3000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Sync did not settle")
    await pause()
  }
}

const setup = (persisted?: { local: ReturnType<typeof workspace>; remote: ReturnType<typeof workspace>; base: string | null | undefined }) => {
  const state = {
    local: workspace(), remote: workspace(), base: scheduleKey(workspace()) as string | null | undefined,
    status: "connecting" as SyncStatus, writes: 0, offline: false,
    hold: undefined as Promise<void> | undefined,
    ...persisted,
  }
  const sync = startScheduleSync({
    read: () => structuredClone(state.local),
    apply: value => { state.local = value },
    base: () => state.base,
    remember: value => { state.base = value },
    exchange: async decide => {
      if (state.offline) throw new Error("offline")
      if (state.hold) await state.hold
      const remote = structuredClone(state.remote)
      const upload = decide(remote)
      if (upload) { state.remote = upload; state.writes++ }
      return remote
    },
    status: value => { state.status = value },
  })
  return { state, sync }
}

test("first connection, offline divergence, deletions, account changes and navigation", () => {
  const local = workspace()
  const remote = workspace("two")
  expect(syncDecision(local, local, undefined)).toBe("equal")
  expect(syncDecision(local, null, undefined)).toBe("upload")
  expect(syncDecision(normalizePlans({}), remote, undefined)).toBe("download")
  expect(syncDecision(normalizePlans({ courses: {} }), remote, undefined)).toBe("download")
  expect(syncDecision(local, remote, undefined)).toBe("conflict")
  expect(syncDecision(local, remote, scheduleKey(local))).toBe("download")
  expect(syncDecision(local, remote, scheduleKey(remote))).toBe("upload")
  expect(syncDecision(local, remote, scheduleKey(workspace("three")))).toBe("conflict")
  expect(syncDecision(local, null, scheduleKey(local))).toBe("conflict")
  expect(syncDecision(local, null, "different-account")).toBe("conflict")
  expect(syncDecision(local, remote, "different-account")).toBe("conflict")
  expect(scheduleKey({ ...local, tab: "exams", semester: "2026b" })).toBe(scheduleKey(local))
  expect(scheduleKey({ plans: local.plans, activePlanId: local.activePlanId })).toBe(scheduleKey(local))
  expect(scheduleKey({ ...local, plans: local.plans.map(plan => ({ courses: plan.courses, name: plan.name, id: plan.id })) })).toBe(scheduleKey(local))
  const navigation = { ...local, tab: "exams", semester: "2026b" }
  expect(withLocalNavigation(remote, navigation)).toMatchObject({ tab: "exams", semester: "2026b" })
  expect(() => readCloudSchedule({ plans: [] })).toThrow()
  expect(readCloudSchedule(undefined)).toBeNull()
})

test("edits upload, remote changes download, and unchanged navigation does not write", async () => {
  const { state, sync } = setup()
  try {
    state.local = workspace("edited")
    sync.schedule(0)
    await until(() => state.status === "synced")
    expect(state.remote).toEqual(state.local)
    expect(state.writes).toBe(1)
    state.remote = workspace("other-device")
    state.status = "connecting"
    sync.schedule(0)
    await until(() => state.status === "synced")
    expect(state.local).toEqual(state.remote)
    state.local.tab = "exams"
    state.status = "connecting"
    sync.schedule(0)
    await until(() => state.status === "synced")
    expect(state.writes).toBe(1)
  } finally { sync.stop() }
})

test("offline edits survive a new session and retry without losing local data", async () => {
  const { state, sync } = setup()
  try {
    state.local = workspace("offline-edit")
    state.offline = true
    sync.schedule(0)
    await until(() => state.status === "error")
    expect(state.local).toEqual(workspace("offline-edit"))
    expect(state.base).toBe(scheduleKey(workspace()))
    expect(syncDecision(state.local, state.remote, state.base)).toBe("upload")
    sync.stop()
    const resumed = setup({ local: state.local, remote: state.remote, base: state.base })
    try {
      resumed.sync.schedule(0)
      await until(() => resumed.state.status === "synced")
      expect(resumed.state.remote).toEqual(state.local)
    } finally { resumed.sync.stop() }
  } finally { sync.stop() }
})

test("concurrent edits pause; a choice cannot overwrite a newer cloud copy", async () => {
  const { state, sync } = setup()
  try {
    state.local = workspace("local-edit")
    state.remote = workspace("remote-edit")
    sync.schedule(0)
    await until(() => state.status === "conflict")
    expect(state.writes).toBe(0)
    const seen = state.remote
    state.remote = workspace("newer-remote-edit")
    state.status = "connecting"
    sync.resolve("upload", seen)
    await until(() => state.status === "conflict")
    expect(state.writes).toBe(0)
    sync.resolve("upload", state.remote)
    await until(() => state.status === "synced")
    expect(state.remote).toEqual(workspace("local-edit"))
  } finally { sync.stop() }
})

test("editing during a download preserves the new local edit and detects conflict", async () => {
  const { state, sync } = setup()
  let release!: () => void
  try {
    state.remote = workspace("cloud")
    state.hold = new Promise(resolve => { release = resolve })
    sync.schedule(0)
    await until(() => state.status === "syncing")
    state.local = workspace("typed-while-waiting")
    release()
    await until(() => state.status === "conflict")
    expect(state.local).toEqual(workspace("typed-while-waiting"))
    expect(state.writes).toBe(0)
  } finally { release?.(); sync.stop() }
})

test("sign-out cancels an in-flight transaction before it writes", async () => {
  const { state, sync } = setup()
  let release!: () => void
  state.local = workspace("edit")
  state.hold = new Promise(resolve => { release = resolve })
  sync.schedule(0)
  await until(() => state.status === "syncing")
  sync.stop()
  release()
  await pause()
  expect(state.writes).toBe(0)
  expect(state.base).toBe(scheduleKey(workspace()))
})
