import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { initializeTestEnvironment } from "@firebase/rules-unit-testing"
import { Bytes, GeoPoint, Timestamp, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore"
import { createServer } from "vite"

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8086")

test("production cloud exchange and local acceptance preserve the first original atomically", { timeout: 60000 }, async () => {
  const uid = "cloud-original-implementation"
  const environment = await initializeTestEnvironment({ projectId: "demo-dibit", firestore: {
    host: "127.0.0.1", port: 8086, rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8"),
  } })
  const database = environment.authenticatedContext(uid).firestore()
  const reference = doc(database, "users", uid)
  const names = ["localStorage", "window", "StorageEvent", "__dibitCloudTest"]
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
  const storage = new Map()
  let failedKey
  class StorageChange extends Event { constructor(type, init) { super(type); this.key = init.key } }
  const connection = { firestore: database, auth: { currentUser: { uid } } }
  Object.defineProperties(globalThis, {
    __dibitCloudTest: { configurable: true, value: connection },
    localStorage: { configurable: true, value: {
      get length() { return storage.size }, key: index => [...storage.keys()][index] ?? null,
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { if (key === failedKey) throw new Error("Quota"); storage.set(key, value) },
      removeItem: key => storage.delete(key),
    } },
    window: { configurable: true, value: { dispatchEvent: () => true } },
    StorageEvent: { configurable: true, value: StorageChange },
  })
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, plugins: [{
    name: "firebase-emulator-connection", enforce: "pre",
    load(id) {
      if (id.endsWith("/src/firebase.ts")) return "export const { auth, firestore } = globalThis.__dibitCloudTest; export const app = undefined"
      return null
    },
  }] })
  const seed = data => environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "users", uid), data))
  try {
    const { exchangeGoogleCopy, loadSyncReview, commitSyncReview, readGoogleCopy } = await server.ssrLoadModule("/src/googleWorkspace.ts")
    const { readLocalCopy, acceptGoogleCopy } = await server.ssrLoadModule("/src/localSchedule.ts")
    const { normalizePlans } = await server.ssrLoadModule("/src/plans.ts")
    const { scheduleKey } = await server.ssrLoadModule("/src/scheduleSync.ts")
    const local = normalizePlans({ semester: "2026a", courses: { "2026a": [{ id: "local", groups: ["01"] }] } })
    storage.set("Dib It", JSON.stringify(local))
    const legacy = { courses: { "2026a": [{ id: "cloud", groups: ["02"] }] }, metadata: {
      timestamp: Timestamp.fromMillis(12345), bytes: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])),
      point: new GeoPoint(30, 40), reference,
    } }
    await seed(legacy)
    const expected = readLocalCopy()
    const uploaded = await exchangeGoogleCopy(uid, () => local)
    assert.equal(acceptGoogleCopy(expected, uid, uploaded.after, false, () => true), true)
    let saved = (await getDoc(reference)).data()
    assert.equal(saved.revision, 1)
    assert.equal(saved.migrationOriginal.metadata.timestamp.isEqual(legacy.metadata.timestamp), true)
    assert.equal(saved.migrationOriginal.metadata.bytes.isEqual(legacy.metadata.bytes), true)
    assert.equal(saved.migrationOriginal.metadata.point.isEqual(legacy.metadata.point), true)
    assert.equal(saved.migrationOriginal.metadata.reference.path, reference.path)
    assert.equal(readGoogleCopy(saved).migrationOriginal.metadata.timestamp.isEqual(legacy.metadata.timestamp), true)
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(readGoogleCopy(saved).migrationOriginal)))
    assert.equal(JSON.parse(storage.get("Dib It Sync")).base, scheduleKey(local))

    // A later whole-copy replacement retains the first original instead of nesting the envelope.
    await exchangeGoogleCopy(uid, () => normalizePlans({ courses: {} }))
    saved = (await getDoc(reference)).data()
    assert.equal(saved.revision, 2)
    assert.equal(saved.migrationOriginal.protocol, undefined)
    assert.deepEqual(saved.migrationOriginal.courses, legacy.courses)

    // Existing protocol-2 backups migrate inside the very transaction that commits a reviewed merge.
    const oldWorkspace = { semester: "2026a", courses: { "2026a": [{ id: "cloud", groups: ["02"] }] } }
    await seed({ protocol: 2, revision: 8, savedAt: serverTimestamp(), workspace: oldWorkspace })
    const merged = normalizePlans({ semester: "2026a", courses: { "2026a": [{ id: "local", groups: ["01"] }, { id: "cloud", groups: ["02"] }] } })
    assert.equal(await commitSyncReview(uid, await loadSyncReview(uid), "merge", merged), "synced")
    saved = (await getDoc(reference)).data()
    assert.equal(saved.revision, 9)
    assert.deepEqual(saved.migrationOriginal, oldWorkspace)
    assert.equal(scheduleKey(readLocalCopy().workspace), scheduleKey(merged))

    // Cloud preservation is not contingent on a later local write succeeding.
    await seed(oldWorkspace)
    const beforeLocal = storage.get("Dib It")
    failedKey = "Dib It"
    const replacement = normalizePlans({ courses: { "2026a": [{ id: "replacement", groups: [] }] } })
    await assert.rejects(commitSyncReview(uid, await loadSyncReview(uid), "merge", replacement), /השלמת הסנכרון/)
    failedKey = undefined
    assert.equal(storage.get("Dib It"), beforeLocal)
    assert.deepEqual((await getDoc(reference)).data().migrationOriginal, oldWorkspace)

    // Both the replacement and retained original must fit; failure leaves the legacy document intact.
    const largeOriginal = { courses: {}, note: "א".repeat(220000) }
    await seed(largeOriginal)
    await assert.rejects(exchangeGoogleCopy(uid, () => ({ ...local, note: "x".repeat(650000) })), /1 MiB/)
    assert.deepEqual((await getDoc(reference)).data(), largeOriginal)
    connection.auth.currentUser = null
    await assert.rejects(exchangeGoogleCopy(uid, () => local), /חשבון גוגל השתנה/)
    assert.deepEqual((await getDoc(reference)).data(), largeOriginal)
    connection.auth.currentUser = { uid }
    await seed({ protocol: 2, revision: 3, savedAt: serverTimestamp(), workspace: { ...local, schemaVersion: 2 } })
    await assert.rejects(exchangeGoogleCopy(uid, () => local), /גרסת הנתונים/)
    assert.equal((await getDoc(reference)).data().workspace.schemaVersion, 2)

    // Extra wrapper fields must not turn a future envelope into a legacy schedule.
    for (const fields of [
      { protocol: 3, workspace: local },
      { protocol: 2, workspace: { ...local, schemaVersion: 2 } },
      { protocol: 2, workspace: local },
    ]) {
      await seed({ ...fields, revision: 10, savedAt: Timestamp.fromMillis(10), theme: "apple" })
      const untouched = (await getDoc(reference)).data()
      assert.throws(() => readGoogleCopy(untouched))
      let decisions = 0
      await assert.rejects(exchangeGoogleCopy(uid, () => { decisions++; return local }))
      assert.equal(decisions, 0)
      assert.deepEqual((await getDoc(reference)).data(), untouched)
    }
    // A protocol metadata field alone is not an envelope discriminator.
    const protocolMetadata = { courses: {}, protocol: 2 }
    assert.equal(readGoogleCopy(protocolMetadata).revision, 0)
    await seed(protocolMetadata)
    await exchangeGoogleCopy(uid, () => local)
    assert.deepEqual((await getDoc(reference)).data().migrationOriginal, protocolMetadata)
  } finally {
    await server.close()
    await environment.cleanup()
    names.forEach((name, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, name, descriptors[index])
      else Reflect.deleteProperty(globalThis, name)
    })
  }
})
