import { expect, test } from "bun:test"
import { normalizePlans } from "../src/plans"
import { CloudScheduleError, cloudScheduleData, readCloudSchedule, scheduleKey, startScheduleSync, syncDecision, withLocalNavigation, LocalSyncSaveError, type SyncStatus } from "../src/scheduleSync"
import { isScheduleBackup } from "../src/scheduleBackup"

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
  const read = () => ({
    version: JSON.stringify(state.local), workspace: structuredClone(state.local), time: null,
    sync: { uid: "test", base: state.base },
  })
  const review = () => ({ local: read(), remote: { workspace: structuredClone(state.remote), revision: state.writes, savedAt: null } })
  const sync = startScheduleSync({
    uid: "test", read, prepare: value => value,
    accept: async (expected, copy, apply, active) => {
      if (!active() || read().version !== expected.version) return false
      if (apply) state.local = withLocalNavigation(copy.workspace, state.local)
      state.base = scheduleKey(copy.workspace)
      return true
    },
    exchange: async decide => {
      if (state.offline) throw new Error("offline")
      if (state.hold) await state.hold
      const before = review().remote
      const upload = decide(before)
      if (upload) { state.remote = upload; state.writes++ }
      return { before, after: review().remote }
    },
    status: value => { state.status = value },
  })
  return { state, sync, review }
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
  const { state, sync, review } = setup()
  try {
    state.local = workspace("local-edit")
    state.remote = workspace("remote-edit")
    sync.schedule(0)
    await until(() => state.status === "conflict")
    expect(state.writes).toBe(0)
    const seen = review()
    state.remote = workspace("newer-remote-edit")
    state.status = "connecting"
    sync.resolve(seen, "upload")
    await until(() => state.status === "conflict")
    expect(state.writes).toBe(0)
    sync.resolve(review(), "upload")
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

test("cloud size accounts for UTF-8 and map overhead while local backups remain valid", () => {
  const local = workspace()
  expect(cloudScheduleData(local, "test-user")).toEqual(JSON.parse(JSON.stringify(local)))
  local.customCourses = { custom: { large: { name: "א".repeat(550000) } } }
  expect(isScheduleBackup(local)).toBe(true)
  expect(() => cloudScheduleData(local, "test-user")).toThrow(CloudScheduleError)
  local.customCourses = { custom: Object.fromEntries(Array.from({ length: 24000 }, (_, i) => [String(i), { name: "test" }])) }
  expect(new TextEncoder().encode(JSON.stringify(local)).length).toBeLessThan(1048576)
  expect(() => cloudScheduleData(local, "test-user")).toThrow(CloudScheduleError)
  local.customCourses = { ["א".repeat(751)]: {} }
  expect(() => cloudScheduleData(local, "test-user")).toThrow(CloudScheduleError)
})

test("permanent upload failures stop retries until the local data changes", async () => {
  let local = workspace()
  let calls = 0
  let status: SyncStatus = "connecting"
  const sync = startScheduleSync({
    uid: "test", prepare: value => value, accept: async () => true,
    read: () => ({ version: JSON.stringify(local), workspace: local, time: null }),
    exchange: async () => { calls++; throw new CloudScheduleError("Too large") },
    status: next => { status = next },
  })
  try {
    sync.schedule(0)
    await until(() => status === "error")
    sync.schedule(0)
    await pause()
    expect(calls).toBe(1)
    expect(status).toBe("error")
    local = workspace("smaller")
    sync.schedule(0)
    await until(() => calls === 2)
  } finally { sync.stop() }
})

test("a reviewed choice cannot overwrite a newer local copy", async () => {
  const { state, sync, review } = setup()
  try {
    const seen = review()
    state.local = workspace("later-local-edit")
    sync.resolve(seen, "upload")
    await until(() => state.status === "conflict")
    expect(state.writes).toBe(0)
    expect(state.local).toEqual(workspace("later-local-edit"))
  } finally { sync.stop() }
})

test("cloud success followed by local failure reports partial completion and does not auto-retry", async () => {
  let status: SyncStatus = "connecting", failure: unknown, writes = 0
  const local = { version: "v1", workspace: workspace(), time: null }
  const sync = startScheduleSync({
    uid: "test", read: () => local, prepare: value => value,
    accept: async () => { throw new Error("Quota exceeded") },
    exchange: async decide => {
      const upload = decide(null)!
      writes++
      return { before: null, after: { workspace: upload, revision: writes, savedAt: null } }
    },
    status: (next, _review, error) => { status = next; failure = error },
  })
  try {
    sync.schedule(0)
    await until(() => status === "error")
    expect(failure).toBeInstanceOf(LocalSyncSaveError)
    expect((failure as Error).message).toContain("נשמר בגוגל")
    sync.schedule(0)
    await pause()
    expect(writes).toBe(1)
  } finally { sync.stop() }
})
