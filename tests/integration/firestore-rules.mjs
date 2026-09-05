import { readFile } from "node:fs/promises"
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing"
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from "firebase/firestore"

// This suite must never fall back to a real Firebase project.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8086")
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
  await assertSucceeds(setDoc(reference, {
    courses: { "2026a": [{ id: "01234567", groups: ["01"] }], "2026b": [] },
    theme: "apple",
  }))
  const backup = { courses: { "2026a": [] }, theme: "default" }
  await assertSucceeds(setDoc(reference, backup))
  assert.deepEqual((await assertSucceeds(getDoc(reference))).data(), backup)
  await assertSucceeds(deleteDoc(reference))
  assert.equal((await getDoc(reference)).exists(), false)
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
  const workspace = { plans: [first, second], activePlanId: "second", semester: "2026a" }
  await assertSucceeds(setDoc(reference, workspace))
  assert.deepEqual((await assertSucceeds(getDoc(reference))).data(), workspace)
  const remaining = { ...workspace, plans: [first], activePlanId: "first" }
  await assertSucceeds(setDoc(reference, remaining))
  assert.deepEqual((await assertSucceeds(getDoc(reference))).data(), remaining)
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
