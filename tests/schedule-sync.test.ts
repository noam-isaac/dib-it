import { expect, test } from "bun:test"
import { compareSchedules } from "../src/scheduleMerge"
import { normalizePlans } from "../src/plans"
import {
  CloudScheduleError,
  cloudScheduleData,
  assertCloudDocumentSize,
  readCloudSchedule,
  scheduleKey,
  startScheduleSync,
  syncDecision,
  withLocalNavigation,
  LocalSyncSaveError,
  baseForAccount,
  readSyncBase,
  cloudCopyKey,
  reviewWorkspaceKey,
  UNAVAILABLE_SYNC_HISTORY,
  type SyncStatus,
  type SyncOptions,
} from "../src/scheduleSync"
import { Bytes, GeoPoint, Timestamp, vector } from "firebase/firestore"
import { isScheduleBackup, readScheduleBackup } from "../src/scheduleBackup"
import {
  UnsupportedWorkspaceVersionError,
  decodeWorkspace,
} from "../src/workspaceFormat"

const workspace = (id = "one") =>
  normalizePlans({
    semester: "2026a",
    courses: { "2026a": [{ id, groups: ["01"] }] },
  })
const selection = (group: string) =>
  normalizePlans({
    semester: "2026a",
    courses: { "2026a": [{ id: "one", groups: [group] }] },
  })
const pause = () => new Promise((resolve) => setTimeout(resolve, 10))
const until = async (check: () => boolean) => {
  const deadline = Date.now() + 3000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Sync did not settle")
    await pause()
  }
}

const setup = (persisted?: {
  local: ReturnType<typeof workspace>
  remote: ReturnType<typeof workspace>
  base: string | null | undefined
}) => {
  const state = {
    local: workspace(),
    remote: workspace(),
    base: scheduleKey(workspace()) as string | null | undefined,
    status: "connecting" as SyncStatus,
    writes: 0,
    offline: false,
    hold: undefined as Promise<void> | undefined,
    ...persisted,
  }
  const read = () => ({
    version: JSON.stringify(state.local),
    workspace: structuredClone(state.local),
    time: null,
    sync: { uid: "test", base: state.base },
  })
  const review = () => ({
    local: read(),
    remote: {
      workspace: structuredClone(state.remote),
      revision: state.writes,
      savedAt: null,
    },
  })
  const sync = startScheduleSync({
    uid: "test",
    read,
    prepare: (value) => value,
    accept: async (expected, copy, apply, active) => {
      if (!active() || read().version !== expected.version) return false
      if (apply) state.local = withLocalNavigation(copy.workspace, state.local)
      state.base = scheduleKey(copy.workspace)
      return true
    },
    exchange: async (decide) => {
      if (state.offline) throw new Error("offline")
      if (state.hold) await state.hold
      const before = review().remote
      const upload = decide(before)
      if (upload) {
        state.remote = upload
        state.writes++
      }
      return { before, after: review().remote }
    },
    status: (value) => {
      state.status = value
    },
  })
  return { state, sync, review }
}

test("first connection, offline divergence, deletions, account changes and navigation", () => {
  const local = workspace()
  const remote = workspace("two")
  expect(syncDecision(local, local, undefined)).toBe("equal")
  expect(syncDecision(local, null, undefined)).toBe("upload")
  expect(syncDecision(normalizePlans({}), remote, undefined)).toBe("download")
  expect(syncDecision(normalizePlans({ courses: {} }), remote, undefined)).toBe(
    "download",
  )
  expect(syncDecision(local, remote, undefined)).toBe("conflict")
  expect(syncDecision(local, remote, scheduleKey(local))).toBe("download")
  expect(syncDecision(local, remote, scheduleKey(remote))).toBe("upload")
  expect(syncDecision(local, remote, scheduleKey(workspace("three")))).toBe(
    "conflict",
  )
  expect(syncDecision(local, remote, "different-account")).toBe("conflict")
  expect(scheduleKey({ ...local, tab: "exams", semester: "2026b" })).toBe(
    scheduleKey(local),
  )
  expect(
    scheduleKey({ plans: local.plans, activePlanId: local.activePlanId }),
  ).toBe(scheduleKey(local))
  expect(
    scheduleKey({
      ...local,
      plans: local.plans.map((plan) => ({
        courses: plan.courses,
        name: plan.name,
        id: plan.id,
      })),
    }),
  ).toBe(scheduleKey(local))
  const navigation = { ...local, tab: "exams", semester: "2026b" }
  expect(withLocalNavigation(remote, navigation)).toMatchObject({
    tab: "exams",
    semester: "2026b",
  })
  expect(() => readCloudSchedule({ plans: [] })).toThrow()
  expect(readCloudSchedule(undefined)).toBeNull()
})

test.each([
  undefined,
  null,
  scheduleKey(workspace()),
  "different-account",
  UNAVAILABLE_SYNC_HISTORY,
])(
  "an absent Google backup uploads without conflict regardless of history (%p)",
  (base) => {
    expect(syncDecision(workspace(), null, base)).toBe("upload")
  },
)

test("a copy created during the first upload is rechecked on transaction retry", async () => {
  const local = {
    workspace: workspace(),
    version: "v1",
    time: null,
    sync: { uid: "previous-account", base: scheduleKey(workspace()) },
  }
  const remote = {
    workspace: workspace("created-on-another-device"),
    revision: 1,
    savedAt: null,
  }
  let status: SyncStatus = "connecting",
    accepted = false
  let proposals: (ReturnType<typeof workspace> | undefined)[] = []
  const sync = startScheduleSync({
    uid: "new-account",
    read: () => local,
    prepare: (value) => value,
    accept: async () => {
      accepted = true
      return true
    },
    exchange: async (decide) => {
      // Firestore discards the first attempt when another device creates the document.
      proposals = [decide(null), decide(remote)]
      return { before: remote, after: remote }
    },
    status: (next) => {
      status = next
    },
  })
  try {
    sync.schedule(0)
    await until(() => status === "conflict")
    expect(proposals).toEqual([local.workspace, undefined])
    expect(accepted).toBe(false)
  } finally {
    sync.stop()
  }
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
  } finally {
    sync.stop()
  }
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
    const resumed = setup({
      local: state.local,
      remote: state.remote,
      base: state.base,
    })
    try {
      resumed.sync.schedule(0)
      await until(() => resumed.state.status === "synced")
      expect(resumed.state.remote).toEqual(state.local)
    } finally {
      resumed.sync.stop()
    }
  } finally {
    sync.stop()
  }
})

test("concurrent edits pause; a choice cannot overwrite a newer cloud copy", async () => {
  const { state, sync, review } = setup()
  try {
    state.local = selection("local-edit")
    state.remote = selection("remote-edit")
    sync.schedule(0)
    await until(() => state.status === "conflict")
    expect(state.writes).toBe(0)
    const seen = review()
    state.remote = selection("newer-remote-edit")
    state.status = "connecting"
    sync.resolve(seen, "upload")
    await until(() => state.status === "conflict")
    expect(state.writes).toBe(0)
    sync.resolve(review(), "upload")
    await until(() => state.status === "synced")
    expect(state.remote).toEqual(selection("local-edit"))
  } finally {
    sync.stop()
  }
})

test("automatic sync combines independent additions, removals and settings without review", async () => {
  const base = workspace()
  const { state, sync } = setup({
    local: workspace("local-addition"),
    remote: { ...base, theme: "google" },
    base: scheduleKey(base),
  })
  try {
    sync.schedule(0)
    await until(() => state.status === "synced" || state.status === "conflict")
    expect(state.status).toBe("synced")
    expect(state.local).toEqual({
      ...workspace("local-addition"),
      theme: "google",
    })
    expect(state.remote).toEqual(state.local)
    expect(state.base).toBe(scheduleKey(state.local))
    expect(state.writes).toBe(1)
  } finally {
    sync.stop()
  }
})

test.each([undefined, "different-account", UNAVAILABLE_SYNC_HISTORY])(
  "automatic sync cannot infer a safe merge without shared history (%p)",
  async (base) => {
    const local = workspace("local")
    const remote = workspace("remote")
    const { state, sync } = setup({ local, remote, base })
    try {
      sync.schedule(0)
      await until(
        () => state.status === "conflict" || state.status === "synced",
      )
      expect(state.status).toBe("conflict")
      expect(state.writes).toBe(0)
      expect(state.local).toEqual(local)
      expect(state.remote).toEqual(remote)
    } finally {
      sync.stop()
    }
  },
)

test.each(["conflicting-cloud", "changed-catalog"])(
  "automatic merge rechecks %s on transaction retry",
  async (change) => {
    const base = workspace()
    const local = { ...base, theme: "google" as const }
    const independent = {
      ...base,
      plans: base.plans.map((plan) => ({ ...plan, name: "remote" })),
    }
    const competing = { ...independent, theme: "apple" as const }
    let status: SyncStatus = "connecting"
    let changedCatalog = false
    let proposals: (typeof local | ReturnType<typeof workspace> | undefined)[] =
      []
    const sync = startScheduleSync({
      uid: "test",
      read: () => ({
        workspace: local,
        version: "v1",
        time: null,
        sync: { uid: "test", base: scheduleKey(base) },
      }),
      // An arriving catalog changes a selection. No unseen result may be uploaded.
      prepare: (value) => (changedCatalog ? workspace("reconciled") : value),
      accept: async () => {
        throw new Error("No attempt may be accepted")
      },
      exchange: async (decide) => {
        const remote = (workspace: ReturnType<typeof selection>) => ({
          workspace,
          revision: 1,
          savedAt: null,
        })
        const first = decide(remote(independent))
        changedCatalog = change === "changed-catalog"
        const latest = remote(changedCatalog ? independent : competing)
        proposals = [first, decide(latest)]
        return { before: latest, after: latest }
      },
      status: (next) => {
        status = next
      },
    })
    try {
      sync.schedule(0)
      await until(() => status === "conflict")
      expect(proposals[0]).toMatchObject({
        theme: "google",
        plans: [{ name: "remote" }],
      })
      expect(proposals[1]).toBeUndefined()
    } finally {
      sync.stop()
    }
  },
)

test.each(["before-decision", "after-decision"])(
  "an overlapping save cannot cause a stale automatic conflict (%s)",
  async (timing) => {
    let local = selection("first-edit")
    let base = scheduleKey(workspace())
    const remote = {
      workspace: selection("latest-edit"),
      revision: 2,
      savedAt: 123,
    }
    let exchanges = 0
    let statuses: SyncStatus[] = []
    const read = () => ({
      workspace: local,
      version: JSON.stringify(local),
      time: null,
      sync: { uid: "test", base },
    })
    const finishOtherSave = () => {
      local = remote.workspace
      base = scheduleKey(remote.workspace)
    }
    const sync = startScheduleSync({
      uid: "test",
      read,
      prepare: (value) => value,
      accept: async (expected) => expected.version === read().version,
      exchange: async (decide) => {
        exchanges++
        if (exchanges === 1 && timing === "before-decision") finishOtherSave()
        expect(decide(remote)).toBeUndefined()
        if (exchanges === 1 && timing === "after-decision") finishOtherSave()
        return { before: remote, after: remote }
      },
      status: (status) => {
        statuses = [...statuses, status]
      },
    })
    try {
      sync.schedule(0)
      await until(
        () => statuses.includes("synced") || statuses.includes("conflict"),
      )
      expect(statuses).not.toContain("conflict")
      expect(statuses.at(-1)).toBe("synced")
      expect(local).toEqual(remote.workspace)
    } finally {
      sync.stop()
    }
  },
)

test("a redundant cloud save does not invalidate a reviewed download", async () => {
  const { state, sync, review } = setup()
  try {
    const seen = review()
    state.writes++
    sync.resolve(seen, "download")
    await until(() => state.status === "synced" || state.status === "conflict")
    expect(state.status).toBe("synced")
    expect(state.writes).toBe(1)
  } finally {
    sync.stop()
  }
})

test("editing during a download preserves the new local edit and detects conflict", async () => {
  const { state, sync } = setup()
  let release!: () => void
  try {
    state.remote = selection("cloud")
    state.hold = new Promise((resolve) => {
      release = resolve
    })
    sync.schedule(0)
    await until(() => state.status === "syncing")
    state.local = selection("typed-while-waiting")
    release()
    await until(() => state.status === "conflict")
    expect(state.local).toEqual(selection("typed-while-waiting"))
    expect(state.writes).toBe(0)
  } finally {
    release?.()
    sync.stop()
  }
})

test("sign-out cancels an in-flight transaction before it writes", async () => {
  const { state, sync } = setup()
  let release!: () => void
  state.local = workspace("edit")
  state.hold = new Promise((resolve) => {
    release = resolve
  })
  sync.schedule(0)
  await until(() => state.status === "syncing")
  sync.stop()
  release()
  await pause()
  expect(state.writes).toBe(0)
  expect(state.base).toBe(scheduleKey(workspace()))
})

test("restarting waits for a stopped upload to record history and preserves a local undo", async () => {
  let local = selection("upload")
  let remote = selection("original")
  let base = scheduleKey(remote)
  let exchanges = 0
  let writes = 0
  let status: SyncStatus = "connecting"
  let release!: () => void
  const response = new Promise<void>((resolve) => {
    release = resolve
  })
  const options: SyncOptions = {
    uid: "stopped-upload",
    prepare: (value) => value,
    read: () => ({
      workspace: local,
      version: JSON.stringify(local),
      time: null,
      sync: { uid: "stopped-upload", base },
    }),
    exchange: async (decide) => {
      exchanges++
      const before = { workspace: remote, revision: writes, savedAt: null }
      const upload = decide(before)
      if (upload) {
        remote = upload
        writes++
      }
      const after = { workspace: remote, revision: writes, savedAt: null }
      if (exchanges === 1) await response
      return { before, after }
    },
    accept: async (_expected, copy, apply, active) => {
      expect(active()).toBe(true)
      if (apply) local = copy.workspace
      base = scheduleKey(copy.workspace)
      return scheduleKey(local) === base
    },
    status: (value) => {
      status = value
    },
  }
  const first = startScheduleSync(options)
  let resumed: ReturnType<typeof startScheduleSync> | undefined
  try {
    first.schedule(0)
    await until(() => writes === 1)
    first.stop()
    local = selection("original")
    resumed = startScheduleSync(options)
    resumed.schedule(0)
    await pause()
    expect(exchanges).toBe(1)
    release()
    await until(() => status === "synced")
    expect(local).toEqual(selection("original"))
    expect(remote).toEqual(local)
    expect(writes).toBe(2)
  } finally {
    release()
    first.stop()
    resumed?.stop()
  }
})

test("cloud size accounts for UTF-8 and map overhead while local backups remain valid", () => {
  const local = workspace()
  expect(cloudScheduleData(local, "test-user")).toEqual(
    JSON.parse(JSON.stringify(local)),
  )
  local.customCourses = { custom: { large: { name: "א".repeat(550000) } } }
  expect(isScheduleBackup(local)).toBe(true)
  expect(() => cloudScheduleData(local, "test-user")).toThrow(
    CloudScheduleError,
  )
  local.customCourses = {
    custom: Object.fromEntries(
      Array.from({ length: 24000 }, (_, i) => [String(i), { name: "test" }]),
    ),
  }
  expect(new TextEncoder().encode(JSON.stringify(local)).length).toBeLessThan(
    1048576,
  )
  expect(() => cloudScheduleData(local, "test-user")).toThrow(
    CloudScheduleError,
  )
  local.customCourses = { ["א".repeat(751)]: {} }
  expect(() => cloudScheduleData(local, "test-user")).toThrow(
    CloudScheduleError,
  )
})

test("permanent upload failures stop retries until the local data changes", async () => {
  let local = workspace()
  let calls = 0
  let status: SyncStatus = "connecting"
  const sync = startScheduleSync({
    uid: "test",
    prepare: (value) => value,
    accept: async () => true,
    read: () => ({
      version: JSON.stringify(local),
      workspace: local,
      time: null,
    }),
    exchange: async () => {
      calls++
      throw new CloudScheduleError("Too large")
    },
    status: (next) => {
      status = next
    },
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
  } finally {
    sync.stop()
  }
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
  } finally {
    sync.stop()
  }
})

test("cloud success followed by local failure reports partial completion and does not auto-retry", async () => {
  let status: SyncStatus = "connecting",
    failure: unknown,
    writes = 0
  const local = { version: "v1", workspace: workspace(), time: null }
  const sync = startScheduleSync({
    uid: "test",
    read: () => local,
    prepare: (value) => value,
    accept: async () => {
      throw new Error("Quota exceeded")
    },
    exchange: async (decide) => {
      const upload = decide(null)!
      writes++
      return {
        before: null,
        after: { workspace: upload, revision: writes, savedAt: null },
      }
    },
    status: (next, _review, error) => {
      status = next
      failure = error
    },
  })
  try {
    sync.schedule(0)
    await until(() => status === "error")
    expect(failure).toBeInstanceOf(LocalSyncSaveError)
    expect((failure as Error).message).toContain("נשמר בגוגל")
    sync.schedule(0)
    await pause()
    expect(writes).toBe(1)
  } finally {
    sync.stop()
  }
})

test("safe historical baselines retain meaning without inventing active-plan context", () => {
  const plans = [
    {
      id: "first",
      name: "First",
      semester: "2026a",
      courses: { "2026a": [{ id: "one", groups: ["01"] }] },
    },
    { id: "second", name: "Second", semester: "2026b", courses: {} },
  ]
  const legacyKey = JSON.stringify({ plans })
  const base = readSyncBase(legacyKey)!
  const otherActive = decodeWorkspace({ plans, activePlanId: "second" })
  expect(scheduleKey(base)).toBe(scheduleKey(otherActive))
  expect(JSON.parse(scheduleKey(base)!)[0]).toHaveProperty("schemaVersion", 1)
  const remote = { ...base, theme: "google" as const }
  expect(syncDecision(base, remote, legacyKey)).toBe("download")
  expect(syncDecision(remote, base, legacyKey)).toBe("upload")
  expect(
    readSyncBase(
      JSON.stringify({
        plans: plans.map((plan, index) => ({
          ...plan,
          theme: index ? "apple" : "google",
        })),
      }),
    ),
  ).toBeUndefined()
})

test("unusable history never becomes permission for a first-connection replacement", () => {
  const empty = normalizePlans({}),
    remote = workspace("cloud")
  const unavailable = baseForAccount(
    { workspace: empty, version: "v", time: null, historyUnavailable: true },
    "test",
  )
  expect(unavailable).toBe(UNAVAILABLE_SYNC_HISTORY)
  expect(syncDecision(empty, remote, unavailable)).toBe("conflict")
  expect(syncDecision(remote, remote, unavailable)).toBe("equal")
  expect(syncDecision(empty, remote, "{bad json")).toBe("conflict")
  expect(
    syncDecision(
      empty,
      remote,
      JSON.stringify({ ...remote, schemaVersion: 2 }),
    ),
  ).toBe("conflict")
  expect(syncDecision(empty, remote, undefined)).toBe("download")
})

test("future backups fail before conversion and reviewed copies include archived changes", () => {
  const local = workspace()
  const future = { ...local, schemaVersion: 2 }
  expect(() => readScheduleBackup(future)).toThrow(
    UnsupportedWorkspaceVersionError,
  )
  expect(() => readCloudSchedule(future)).toThrow(
    UnsupportedWorkspaceVersionError,
  )
  expect(isScheduleBackup(future)).toBe(false)
  const retired = {
    ...local,
    plans: local.plans.map((plan) => ({ ...plan, semester: "obsolete" })),
  }
  expect(scheduleKey(local)).toBe(scheduleKey(retired))
  const copy = (value: typeof local) => ({
    workspace: value,
    revision: 0,
    savedAt: null,
  })
  expect(cloudCopyKey(copy(local))).not.toBe(cloudCopyKey(copy(retired)))
})

test("cloud capacity includes the retained original and native Firestore values", () => {
  const migrationOriginal = {
    note: Bytes.fromUint8Array(new Uint8Array(500000)),
    point: new GeoPoint(1, 2),
    time: Timestamp.fromMillis(0),
    vector: vector([1, 2]),
  }
  const envelope = {
    protocol: 2,
    revision: 1,
    savedAt: Timestamp.fromMillis(0),
    workspace: { note: "x".repeat(500000) },
    migrationOriginal,
  }
  expect(() => assertCloudDocumentSize(envelope, "test")).not.toThrow()
  expect(() =>
    assertCloudDocumentSize(
      {
        ...envelope,
        migrationOriginal: {
          ...migrationOriginal,
          note: Bytes.fromUint8Array(new Uint8Array(600000)),
        },
      },
      "test",
    ),
  ).toThrow(CloudScheduleError)
  expect(migrationOriginal.note.toUint8Array().byteLength).toBe(500000)
  expect(migrationOriginal.time).toBeInstanceOf(Timestamp)
})

test("approved choices survive offline retry and include unrelated newer edits", async () => {
  const base = workspace()
  const { state, sync, review } = setup({
    local: selection("local"),
    remote: selection("remote"),
    base: scheduleKey(base),
  })
  const seen = review()
  const conflict = compareSchedules(base, state.local, state.remote)
    .unresolved[0]!
  try {
    state.offline = true
    sync.resolveChanges(seen, { [conflict.key]: "remote" })
    await until(() => state.status === "error")
    state.local = { ...state.local, theme: "google" }
    state.remote = {
      ...state.remote,
      plans: state.remote.plans.map((plan) => ({
        ...plan,
        name: "Other device",
      })),
    }
    state.offline = false
    sync.retry()
    await until(() => state.status === "synced")
    expect(state.local.plans[0]!.courses!["2026a"]![0]!.groups).toEqual([
      "remote",
    ])
    expect(state.local.theme).toBe("google")
    expect(state.local.plans[0]!.name).toBe("Other device")
    expect(scheduleKey(state.local)).toBe(scheduleKey(state.remote))
  } finally {
    sync.stop()
  }
})

test("an approved choice cannot replace a newly changed alternative during retry", async () => {
  const base = workspace()
  const { state, sync, review } = setup({
    local: selection("local"),
    remote: selection("remote"),
    base: scheduleKey(base),
  })
  const conflict = compareSchedules(base, state.local, state.remote)
    .unresolved[0]!
  try {
    state.offline = true
    sync.resolveChanges(review(), { [conflict.key]: "local" })
    await until(() => state.status === "error")
    state.remote = selection("new remote choice")
    state.offline = false
    sync.retry()
    await until(() => state.status === "conflict")
    expect(state.writes).toBe(0)
    expect(state.local).toEqual(selection("local"))
    expect(state.remote).toEqual(selection("new remote choice"))
  } finally {
    sync.stop()
  }
})

test("a competing edit reverted while offline no longer needs a decision", async () => {
  const base = workspace()
  const { state, sync, review } = setup({
    local: selection("02"),
    remote: selection("03"),
    base: scheduleKey(base),
  })
  const conflict = compareSchedules(base, state.local, state.remote)
    .unresolved[0]!
  try {
    state.offline = true
    sync.resolveChanges(review(), { [conflict.key]: "local" })
    await until(() => state.status === "error")
    state.remote = base
    state.offline = false
    sync.retry()
    await until(() => state.status === "synced")
    expect(state.remote).toEqual(selection("02"))
    expect(state.local).toEqual(selection("02"))
  } finally {
    sync.stop()
  }
})

test("sync keys preserve source precedence and reject ambiguous historical receipts", () => {
  const first = { custom: { name: "First" } }
  const second = { custom: { name: "Second" } }
  const base = { ...workspace(), customCourses: { first, second } }
  const reordered = { ...base, customCourses: { second, first } }
  expect(scheduleKey(base)).not.toBe(scheduleKey(reordered))
  expect(reviewWorkspaceKey(base)).not.toBe(reviewWorkspaceKey(reordered))
  expect(syncDecision(base, reordered, undefined)).toBe("conflict")
  expect(syncDecision(reordered, base, scheduleKey(base))).toBe("upload")
  expect(
    syncDecision(reordered, { ...base, theme: "google" }, scheduleKey(base)),
  ).toBe("conflict")
  expect(
    Object.keys(readSyncBase(scheduleKey(reordered))!.customCourses!),
  ).toEqual(["second", "first"])
  const historical = JSON.stringify(JSON.parse(scheduleKey(base)!)[0])
  expect(readSyncBase(historical)).toBeUndefined()
  expect(syncDecision(base, base, historical)).toBe("equal")
  expect(
    syncDecision(reordered, { ...base, theme: "google" }, historical),
  ).toBe("conflict")
  expect(
    readSyncBase(JSON.stringify([JSON.parse(historical), ["first", "first"]])),
  ).toBeUndefined()
  const equivalent = { ...base, customCourses: { first, second: first } }
  expect(
    readSyncBase(JSON.stringify(JSON.parse(scheduleKey(equivalent)!)[0])),
  ).toBeDefined()
})

test("matching schedules ignore harmless source order even without usable history", () => {
  for (const shared of [{}, { shared: { name: "Identical" } }]) {
    const a = { one: { name: "One" }, ...shared }
    const b = { two: { name: "Two" }, ...shared }
    const local = { ...workspace(), customCourses: { a, b } }
    const remote = { ...local, customCourses: { b, a } }
    expect(scheduleKey(local)).not.toBe(scheduleKey(remote))
    expect(reviewWorkspaceKey(local)).toBe(reviewWorkspaceKey(remote))
    expect(reviewWorkspaceKey(local)).not.toBe(
      reviewWorkspaceKey({ ...remote, note: "Real metadata change" }),
    )
    for (const base of [
      undefined,
      "different-account",
      UNAVAILABLE_SYNC_HISTORY,
      "{bad json",
    ]) {
      expect(syncDecision(local, remote, base)).toBe("equal")
      expect(syncDecision(remote, local, base)).toBe("equal")
    }
    expect(
      syncDecision(local, { ...remote, customCourses: { b } }, undefined),
    ).toBe("conflict")
    expect(
      syncDecision(
        local,
        { ...remote, note: "Real metadata change" },
        undefined,
      ),
    ).toBe("conflict")
  }
  const shadowed = {
    ...workspace(),
    customCourses: {
      first: { one: { name: "Shadowed" } },
      last: { one: { name: "Winner" } },
    },
  }
  expect(
    syncDecision(
      shadowed,
      {
        ...shadowed,
        customCourses: {
          ...shadowed.customCourses,
          first: { one: { name: "Edited shadowed definition" } },
        },
      },
      undefined,
    ),
  ).toBe("conflict")
})
