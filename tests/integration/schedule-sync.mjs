import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { initializeTestEnvironment } from "@firebase/rules-unit-testing"
import { doc, onSnapshot, runTransaction, setDoc, disableNetwork, enableNetwork } from "firebase/firestore"
import { createServer } from "vite"

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8086")
const until = async check => {
  const deadline = Date.now() + 15000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Emulator sync did not settle")
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test("real Firestore clients sync, reconnect, and preserve competing edits", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false } })
  const environment = await initializeTestEnvironment({
    projectId: "demo-dibit",
    firestore: { host: "127.0.0.1", port: 8086, rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8") },
  })
  const clients = []
  try {
    const { startScheduleSync, readCloudSchedule, scheduleKey } = await server.ssrLoadModule("/src/scheduleSync.ts")
    const { normalizePlans } = await server.ssrLoadModule("/src/plans.ts")
    const createClient = (local = normalizePlans({})) => {
      const database = environment.authenticatedContext("sync-emulator").firestore()
      const reference = doc(database, "users", "sync-emulator")
      const client = { local, base: undefined, status: "connecting", database, reference }
      const sync = startScheduleSync({
        read: () => structuredClone(client.local),
        apply: value => { client.local = value },
        base: () => client.base,
        remember: value => { client.base = value },
        exchange: decide => runTransaction(database, async transaction => {
          const remote = readCloudSchedule((await transaction.get(reference)).data())
          const upload = decide(remote)
          if (upload) transaction.set(reference, JSON.parse(JSON.stringify(upload)))
          return remote
        }),
        status: status => { client.status = status },
      })
      const unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) sync.schedule(0)
      })
      client.sync = sync
      client.stop = () => { sync.stop(); unsubscribe() }
      clients.push(client)
      return client
    }
    const first = createClient(normalizePlans({ courses: { "2026a": [{ id: "12345678", groups: ["01"] }] } }))
    await until(() => first.status === "synced")
    const second = createClient()
    await until(() => second.status === "synced")
    assert.equal(scheduleKey(second.local), scheduleKey(first.local))

    first.local.plans[0].name = "First device edit"
    first.sync.schedule(0)
    await until(() => second.local.plans[0].name === "First device edit")
    await until(() => first.status === "synced" && second.status === "synced")

    await disableNetwork(first.database)
    first.local.plans[0].name = "Offline edit"
    first.sync.schedule(0)
    // disableNetwork suspends listeners; transaction RPCs may still reach the emulator.
    // Rejected offline requests and reload persistence are checked by the controller tests.
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(first.local.plans[0].name, "Offline edit")
    await enableNetwork(first.database)
    first.sync.schedule(0)
    await until(() => second.local.plans[0].name === "Offline edit")
    await until(() => first.status === "synced" && second.status === "synced")

    first.local.plans[0].name = "Concurrent A"
    second.local.plans[0].name = "Concurrent B"
    first.sync.schedule(0)
    second.sync.schedule(0)
    await until(() => clients.some(client => client.status === "conflict"))
    assert.equal(first.local.plans[0].name, "Concurrent A")
    assert.equal(second.local.plans[0].name, "Concurrent B")

    const before = clients.map(client => structuredClone(client.local))
    await setDoc(first.reference, { plans: [] })
    await until(() => clients.every(client => client.status === "error"))
    assert.deepEqual(clients.map(client => client.local), before)
  } finally {
    clients.forEach(client => client.stop())
    await environment.cleanup()
    await server.close()
  }
})
