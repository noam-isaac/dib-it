import { readFile } from "node:fs/promises"
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing"
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp, Timestamp, Bytes, GeoPoint } from "firebase/firestore"

// This suite must never fall back to a real Firebase project.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8086")
const envelope = (workspace, revision) => ({ protocol: 2, revision, savedAt: serverTimestamp(), workspace })
const workspace = courses => ({ schemaVersion: 1, activePlanId: "default", plans: [{ id: "default", name: "Main", courses }] })
let environment
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-dibit",
    firestore: {
      host: "127.0.0.1",
      port: 8086,
      rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8"),
    },
  })
})
after(async () => environment?.cleanup())

test("private backup round trip replaces deleted semesters and courses", async () => {
  const database = environment.authenticatedContext("alice").firestore()
  const reference = doc(database, "users", "alice")
  await assertSucceeds(setDoc(reference, envelope({
    ...workspace({ "2026a": [{ id: "01234567", groups: ["01"] }], "2026b": [] }),
    theme: "apple",
  }, 1)))
  const backup = { ...workspace({ "2026a": [] }), theme: "google" }
  await assertSucceeds(setDoc(reference, envelope(backup, 2)))
  assert.deepEqual((await assertSucceeds(getDoc(reference))).data().workspace, backup)
  await assertFails(deleteDoc(reference))
  await assertFails(setDoc(reference, backup))
  await assertFails(setDoc(reference, envelope(backup, 2)))
  await assertFails(setDoc(reference, { ...envelope(backup, 3), savedAt: new Date(0) }))
  assert.equal((await getDoc(reference)).exists(), true)
})

test("anonymous users cannot read or write any backup", async () => {
  const database = environment.unauthenticatedContext().firestore()
  const reference = doc(database, "users", "alice")
  await assertFails(getDoc(reference))
  await assertFails(setDoc(reference, { courses: {} }))
  await assertFails(deleteDoc(reference))
})

test("multi-plan backup retains active selection and replacement removes deleted plans", async () => {
  const database = environment.authenticatedContext("plans-user").firestore()
  const reference = doc(database, "users", "plans-user")
  const first = { id: "first", name: "ראשונה", courses: { "2026a": [{ id: "01234567", groups: ["01"] }] } }
  const second = { id: "second", name: "חלופה", courses: { "2026a": [{ id: "01234567", groups: ["02"] }] } }
  const saved = { schemaVersion: 1, plans: [first, second], activePlanId: "second", semester: "2026a" }
  await assertSucceeds(setDoc(reference, envelope(saved, 1)))
  assert.deepEqual((await assertSucceeds(getDoc(reference))).data().workspace, saved)
  const remaining = { ...saved, plans: [first], activePlanId: "first" }
  await assertSucceeds(setDoc(reference, envelope(remaining, 2)))
  assert.deepEqual((await assertSucceeds(getDoc(reference))).data().workspace, remaining)
})

test("signed-in users cannot access others, list users, or create subcollections", async () => {
  const database = environment.authenticatedContext("bob").firestore()
  const other = doc(database, "users", "alice")
  await assertFails(getDoc(other))
  await assertFails(setDoc(other, { courses: {} }))
  await assertFails(deleteDoc(other))
  await assertFails(getDocs(collection(database, "users")))
  await assertFails(setDoc(doc(database, "users/bob/private/extra"), { value: 1 }))
  await assertFails(setDoc(doc(database, "other/bob"), { value: 1 }))
})

test("legacy migration preserves readable data but rejects obsolete writers", async () => {
  const legacy = { courses: { "2026a": [] }, protocol: 2 }
  await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), "users", "legacy"), legacy))
  const reference = doc(environment.authenticatedContext("legacy").firestore(), "users", "legacy")
  assert.deepEqual((await assertSucceeds(getDoc(reference))).data(), legacy)
  await assertFails(setDoc(reference, legacy))
  await assertFails(setDoc(reference, envelope(legacy, 1)))
  await assertFails(setDoc(reference, envelope(workspace(legacy.courses), 1)))
  await assertSucceeds(setDoc(reference, { ...envelope(workspace(legacy.courses), 1), migrationOriginal: legacy }))
  await assertFails(setDoc(reference, legacy))
  await assertFails(deleteDoc(reference))
})

test("migration atomically retains the exact native preimage and cannot drop or rewrite it", async () => {
  const database = environment.authenticatedContext("original").firestore()
  const reference = doc(database, "users", "original")
  const original = { courses: { "2026a": [] }, metadata: { when: Timestamp.fromMillis(1234), bytes: Bytes.fromUint8Array(new Uint8Array([1, 2])), point: new GeoPoint(1, 2), ref: reference } }
  await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), "users", "original"), { protocol: 2, revision: 5, savedAt: serverTimestamp(), workspace: original }))
  await assertFails(setDoc(reference, { ...envelope(workspace({}), 6), migrationOriginal: { ...original, courses: {} } }))
  const converted = { ...envelope(workspace({}), 6), migrationOriginal: original }
  await assertSucceeds(setDoc(reference, converted))
  const read = (await getDoc(reference)).data().migrationOriginal
  assert.equal(read.metadata.when.isEqual(original.metadata.when), true)
  assert.equal(read.metadata.bytes.isEqual(original.metadata.bytes), true)
  assert.equal(read.metadata.point.isEqual(original.metadata.point), true)
  assert.equal(read.metadata.ref.path, original.metadata.ref.path)
  await assertFails(setDoc(reference, envelope(workspace({}), 7)))
  await assertFails(setDoc(reference, { ...envelope(workspace({}), 7), migrationOriginal: { courses: {} } }))
  await assertSucceeds(setDoc(reference, { ...envelope(workspace({ "2026b": [] }), 7), migrationOriginal: original }))
  const fresh = doc(environment.authenticatedContext("no-original").firestore(), "users", "no-original")
  await assertFails(setDoc(fresh, { ...envelope(workspace({}), 1), migrationOriginal: original }))
})

test("unknown workspace/protocol versions remain readable and cannot be downgraded", async () => {
  const database = environment.authenticatedContext("future").firestore()
  const reference = doc(database, "users", "future")
  const future = { protocol: 2, revision: 10, savedAt: serverTimestamp(), workspace: { ...workspace({}), schemaVersion: 2 } }
  await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), "users", "future"), future))
  assert.equal((await assertSucceeds(getDoc(reference))).data().workspace.schemaVersion, 2)
  await assertFails(setDoc(reference, envelope(workspace({}), 11)))
  await assertFails(setDoc(reference, envelope(workspace({}), 1)))
  await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), "users", "future"), { ...future, protocol: 3, workspace: workspace({}) }))
  await assertFails(setDoc(reference, envelope(workspace({}), 11)))
  await assertFails(setDoc(reference, envelope(workspace({}), 1)))
  await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), "users", "future"), { ...workspace({}), schemaVersion: 2 }))
  await assertFails(setDoc(reference, envelope(workspace({}), 1)))
})

test("extra envelope fields cannot bypass version guards or be silently discarded", async () => {
  const database = environment.authenticatedContext("future-wrapper").firestore()
  const reference = doc(database, "users", "future-wrapper")
  for (const fields of [
    { protocol: 3, workspace: workspace({}) },
    { protocol: 2, workspace: { ...workspace({}), schemaVersion: 2 } },
    { protocol: 2, workspace: workspace({}) },
  ]) {
    const original = { ...fields, revision: 10, savedAt: Timestamp.fromMillis(10), theme: "apple" }
    await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "users", "future-wrapper"), original))
    await assertFails(setDoc(reference, { ...envelope(workspace({}), 1), migrationOriginal: original }))
    await assertFails(setDoc(reference, envelope(workspace({}), 11)))
    assert.deepEqual((await getDoc(reference)).data(), original)
  }
})
