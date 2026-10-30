import { prepareAnnualFeed } from "./annual-fixture.mjs"
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

// Browser wiring check with synthetic auth/cloud data only; never contacts Firebase.
const stub = `
import { useEffect, useState } from 'react';
export const auth = { currentUser: { uid: 'test-user', displayName: 'Test', photoURL: null } };
export const firestore = {};
export const app = {};
const listenerErrors = new Map();
const listeners = new Set(), authListeners = new Set();
export class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
export const serverTimestamp = () => Date.now();
let cloud, writes = 0, transactions = 0, offline = false, holdApply, releaseApply, committed = false;
const snapshot = () => ({ data: () => cloud ? { ...structuredClone(cloud), savedAt: new Timestamp(cloud.savedAt) } : undefined, exists: () => cloud !== undefined, metadata: { fromCache: false, hasPendingWrites: false } });
const emit = () => listeners.forEach(fn => fn(snapshot()));
export const doc = () => ({});
export const getDoc = async () => { if (offline) throw new Error('Offline test'); return snapshot(); };
export const getDocFromServer = getDoc;
export const setDoc = async (_ref, value) => { if (offline) throw new Error('Offline test'); cloud = structuredClone(value); writes++; queueMicrotask(emit); };
export const onSnapshot = (_ref, _options, callback, failure) => { listenerErrors.set(callback, failure); listeners.add(callback); queueMicrotask(() => listeners.has(callback) && callback(snapshot())); return () => { listeners.delete(callback); listenerErrors.delete(callback); }; };
export const runTransaction = async (_db, callback) => {
  transactions++;
  if (offline) throw new Error('Offline test');
  let upload;
  const result = await callback({ get: async () => snapshot(), set: (_ref, data) => { upload = data; } });
  if (upload) { cloud = structuredClone(upload); writes++; queueMicrotask(emit); }
  if (upload && holdApply) { committed = true; await holdApply; holdApply = undefined; }
  return result;
};
export const useAuthState = () => {
  const [user, setUser] = useState(auth.currentUser);
  useEffect(() => { authListeners.add(setUser); return () => authListeners.delete(setUser); }, []);
  return [user, false];
};
export class GoogleAuthProvider {}
export const signInWithPopup = async () => {};
export const signOut = async () => { auth.currentUser = null; authListeners.forEach(fn => fn(null)); };
window.syncTest = {
  holdApplication: () => { committed = false; holdApply = new Promise(resolve => { releaseApply = resolve; }); },
  releaseApplication: () => releaseApply(), get committed() { return committed; },
  get cloud() { return cloud; }, get writes() { return writes; }, get transactions() { return transactions; },
  failListener: () => { for (const callback of listeners) { listeners.delete(callback); listenerErrors.get(callback)(new Error('Terminal listener failure')); } },
  get listenerCount() { return listeners.size; },
  remote: data => { cloud = structuredClone(data); emit(); },
  offline: value => { offline = value; if (!value) window.dispatchEvent(new Event('online')); },
};
`
const server = await createServer({
  cacheDir: "node_modules/.vite-schedule-sync-test",
  plugins: [{
    name: "synthetic-schedule-sync",
    resolveId(id) { if (id === "/test-sync-stub") return "\0test-sync-stub" },
    load(id) { if (id === "\0test-sync-stub") return stub },
    transform(code, id) {
      if (id.endsWith("/src/firebase.ts")) return 'export { app, auth, firestore } from "/test-sync-stub"'
      if (/\/src\/components\/(GoogleScheduleSync|GoogleSaveButtons|Header)\.tsx$/.test(id) || id.endsWith("/src/googleWorkspace.ts"))
        return code.replaceAll('"firebase/firestore"', '"/test-sync-stub"').replaceAll('"firebase/auth"', '"/test-sync-stub"').replaceAll('"react-firebase-hooks/auth"', '"/test-sync-stub"')
    },
  }],
  server: { host: "127.0.0.1", port: 0 },
})
const initial = { semester: "2026a", tab: "schedule", plans: [{ id: "first", name: "בדיקה", courses: { "2026a": [{ id: "12345678", groups: ["01"] }] } }], activePlanId: "first" }
let browser
let page
try {
  await server.listen()
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message) })
  page.on("console", message => { if (message.type() === "error") console.error(message.text()) })
  await page.route("**/*", route => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/")) return route.continue()
    if (url.hostname === "127.0.0.1" && url.pathname.startsWith("/data/")) return route.fulfill({ json: url.pathname.endsWith("info.json")
      ? { currentSemester: "2026a", semesters: { "2026a": { startDate: "2025-10-26", endDate: "2026-01-25" } } }
      : url.pathname.includes("courses-") ? { "12345678": { name: "קורס בדיקה", faculty: "פקולטה/חוג", groups: ["01", "02", "03"].map(group => ({ group, lessons: [] })), exams: [] }, "22222222": { name: "קורס נוסף במכשיר", groups: [{ group: "01", lessons: [] }] }, "33333333": { name: "קורס נוסף בגוגל", groups: [{ group: "01", lessons: [] }] } } : {} })
    return route.abort()
  })
  await page.addInitScript(state => localStorage.setItem("Dib It", JSON.stringify(state)), initial)
  await prepareAnnualFeed(page)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await page.getByRole("button", { name: "למערכת השעות", exact: true }).click()
  const menu = async () => page.getByRole("button", { name: "פעולות", exact: true }).click()
  const toggle = () => page.getByRole("menuitemcheckbox", { name: "סנכרון אוטומטי עם גוגל", exact: true })
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.syncTest.transactions), 0, "sign-in must not enable sync")
  await menu()
  assert.equal(await toggle().getAttribute("aria-checked"), "false")
  // Issue #12: the toggle drew a grey pill with no readable state.
  assert.equal(await toggle().getByText("כבוי", { exact: true }).isVisible(), true)
  assert.equal(await toggle().locator("i.fa-toggle-off").count(), 1)
  await page.getByRole("menuitem", { name: "גיבוי בגוגל", exact: true }).click()
  await page.getByRole("button", { name: "אישור החלפת העותק בגוגל", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.syncTest.cloud.workspace.plans[0].name), "בדיקה")
  const edit = name => page.evaluate(async name => {
    const { getWorkspace, setWorkspace } = await import("/src/models.ts")
    const workspace = getWorkspace()
    workspace.plans[0].name = name
    await setWorkspace(workspace)
  }, name)
  await edit("שינוי ידני")
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.syncTest.cloud.workspace.plans[0].name), "בדיקה")
  await menu()
  await page.getByRole("menuitem", { name: "שחזור מגוגל", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "ביטול", exact: true }).click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace.plans[0].name), "שינוי ידני")
  await menu()
  await page.getByRole("menuitem", { name: "שחזור מגוגל", exact: true }).click()
  await page.getByRole("button", { name: "אישור החלפת המערכות במכשיר", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace.plans[0].name), "בדיקה")

  // Conservative merge: independent additions, contents, timestamps, and stale preview.
  await page.evaluate(async () => {
    const { updateWorkspace } = await import("/src/models.ts")
    await updateWorkspace(w => ({ ...w, plans: w.plans.map(p => ({ ...p, courses: { ...p.courses, "2026a": [...p.courses["2026a"], { id: "22222222", groups: ["01"] }] } })) }))
    const remote = structuredClone(window.syncTest.cloud)
    remote.workspace.plans[0].courses["2026a"].push({ id: "33333333", groups: ["01"] })
    remote.revision++
    remote.savedAt = Date.UTC(2026, 9, 29, 10, 30)
    window.syncTest.remote(remote)
  })
  await menu()
  await page.getByRole("menuitem", { name: "שחזור מגוגל", exact: true }).click()
  let dialog = page.getByRole("dialog")
  await dialog.getByText("קורס נוסף במכשיר (22222222) · בדיקה · 2026", { exact: true }).waitFor()
  await dialog.getByText("קורס נוסף בגוגל (33333333) · בדיקה · 2026", { exact: true }).waitFor()
  await dialog.getByText(/נשמר בגוגל:/).waitFor()
  await dialog.getByRole("button", { name: "בדיקת מיזוג", exact: true }).click()
  await dialog.getByText("תוצאת המיזוג לשמירה", { exact: true }).waitFor()
  await page.evaluate(async () => (await import("/src/models.ts")).updateWorkspace(w => ({ ...w, theme: "google" })))
  assert.equal(await dialog.getByRole("button", { name: "שמירת המיזוג", exact: true }).isDisabled(), true)
  await dialog.getByRole("button", { name: "רענון ההשוואה", exact: true }).click()
  await dialog.getByText("ההשוואה עודכנה. בדקו מחדש את הבחירות.", { exact: true }).waitFor()
  await dialog.locator("details").last().locator("summary").click()
  await dialog.getByText("קורס נוסף בגוגל (33333333) — קבוצות 01", { exact: true }).filter({ visible: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  if (process.env.DIBIT_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.DIBIT_SCREENSHOT_DIR}/dibit-merge-mobile.png` })
  await dialog.getByRole("button", { name: "שמירת המיזוג", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.deepEqual(await page.evaluate(() => window.syncTest.cloud.workspace.plans[0].courses["2026a"].map(c => c.id)), ["12345678", "22222222", "33333333"])

  // Same-course choices require an explicit answer; a post-commit edit cannot be erased.
  await page.evaluate(async () => {
    await (await import("/src/models.ts")).updateWorkspace(w => ({ ...w, plans: w.plans.map(p => ({ ...p, courses: { ...p.courses, "2026a": p.courses["2026a"].map(c => c.id === "12345678" ? { ...c, groups: ["02"] } : c) } })) }))
    const remote = structuredClone(window.syncTest.cloud)
    remote.workspace.plans[0].courses["2026a"][0].groups = ["03"]
    remote.revision++
    window.syncTest.remote(remote)
  })
  await menu()
  await page.getByRole("menuitem", { name: "שחזור מגוגל", exact: true }).click()
  dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "בדיקת מיזוג", exact: true }).click()
  assert.equal(await dialog.getByRole("button", { name: "שמירת המיזוג", exact: true }).isDisabled(), true)
  await dialog.getByRole("radio", { name: "הבחירה במכשיר", exact: true }).click()
  await page.evaluate(() => window.syncTest.holdApplication())
  const baseline = await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It Workspace v2")).sync.base)
  await dialog.getByRole("button", { name: "שמירת המיזוג", exact: true }).click()
  await page.waitForFunction(() => window.syncTest.committed)
  assert.equal(await page.evaluate(async () => (await navigator.locks.query()).held.length), 0, "network completion never holds a local lock")
  await page.evaluate(async () => {
    await (await import("/src/models.ts")).updateWorkspace(w => ({ ...w, theme: "apple" }))
    window.syncTest.releaseApplication()
  })
  await dialog.getByText(/הנתונים במכשיר השתנו/).waitFor()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace.theme), "apple")
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It Workspace v2")).sync.base), baseline, "a merge not applied locally must not become its baseline")
  assert.deepEqual(await page.evaluate(() => window.syncTest.cloud.workspace.plans[0].courses["2026a"][0].groups), ["02"])
  await dialog.getByRole("button", { name: "ביטול", exact: true }).click()
  await menu()
  await page.getByRole("menuitem", { name: "גיבוי בגוגל", exact: true }).click()
  await page.getByRole("button", { name: "אישור החלפת העותק בגוגל", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })

  await page.evaluate(() => window.syncTest.offline(true))
  await menu()
  await page.getByRole("menuitem", { name: "גיבוי בגוגל", exact: true }).click()
  await page.getByText("Offline test", { exact: true }).waitFor()
  await page.evaluate(() => window.syncTest.offline(false))
  await menu()
  await toggle().click()
  assert.equal(await toggle().getAttribute("aria-checked"), "true")
  assert.equal(await toggle().getByText("מופעל", { exact: true }).isVisible(), true)
  assert.equal(await toggle().locator("i.fa-toggle-on").count(), 1)
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => window.syncTest.transactions > 0)
  assert.equal(await page.getByText("מסונכרן עם גוגל", { exact: true }).count(), 0)
  await page.waitForTimeout(1200)
  const beforeNavigation = await page.evaluate(() => window.syncTest.transactions)
  await page.getByRole("button", { name: "מבחנים", exact: true }).click()
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.syncTest.transactions), beforeNavigation, "tab changes do not contact cloud")
  await edit("עריכה מקומית")
  await page.waitForFunction(() => window.syncTest.cloud.workspace.plans[0].name === "עריכה מקומית")
  await page.evaluate(() => {
    const remote = structuredClone(window.syncTest.cloud)
    remote.workspace.plans[0].name = "מכשיר אחר"
    window.syncTest.remote(remote)
  })
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace.plans[0].name === "מכשיר אחר")
  await page.evaluate(() => window.syncTest.failListener())
  await edit("עריכה אחרי כשל בהאזנה")
  await page.waitForFunction(() => window.syncTest.cloud.workspace.plans[0].name === "עריכה אחרי כשל בהאזנה")
  assert.equal(await page.evaluate(() => window.syncTest.listenerCount), 0)
  await page.getByText("Terminal listener failure", { exact: true }).waitFor()
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await page.waitForFunction(() => window.syncTest.listenerCount === 1)
  await page.getByText("Terminal listener failure", { exact: true }).waitFor({ state: "hidden" })
  await page.evaluate(() => {
    const remote = structuredClone(window.syncTest.cloud)
    remote.workspace.plans[0].name = "עדכון אחרי חיבור מחדש"
    window.syncTest.remote(remote)
  })
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace.plans[0].name === "עדכון אחרי חיבור מחדש")
  await page.evaluate(() => window.syncTest.offline(true))
  await edit("עריכה ללא רשת")
  await page.getByText("הסנכרון לגוגל לא הושלם. הנתונים במכשיר נשמרו.", { exact: true }).waitFor()
  await page.evaluate(() => {
    const remote = structuredClone(window.syncTest.cloud)
    remote.workspace.plans[0].name = "עריכה מרוחקת"
    window.syncTest.remote(remote)
    window.syncTest.offline(false)
  })
  await page.getByRole("button", { name: "השוואה ומיזוג מערכות", exact: true }).click()
  await page.getByRole("dialog").getByText("במכשיר: עריכה ללא רשת", { exact: true }).waitFor()
  await page.getByRole("button", { name: "שימוש בעותק מגוגל", exact: true }).click()
  await page.getByRole("button", { name: "אישור החלפת המערכות במכשיר", exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("Dib It Workspace v2")).workspace.plans[0].name === "עריכה מרוחקת")
  await page.waitForTimeout(100)
  await menu()
  assert.equal(await toggle().getAttribute("aria-checked"), "true")
  await edit("שינוי לפני כיבוי")
  await toggle().click()
  await page.keyboard.press("Escape")
  const stopped = await page.evaluate(() => window.syncTest.transactions)
  await edit("סנכרון כבוי")
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.syncTest.transactions), stopped)
  await page.reload()
  await page.getByRole("button", { name: "פעולות", exact: true }).waitFor()
  await menu()
  assert.equal(await toggle().getAttribute("aria-checked"), "false", "toggle choice survives reload")
  assert.equal(await page.evaluate(() => window.syncTest.transactions), 0)
  await toggle().click()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /התנתק\/י/ }).click()
  const writes = await page.evaluate(() => window.syncTest.writes)
  await edit("אחרי התנתקות")
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.syncTest.writes), writes)
  assert.deepEqual(errors, [])
  console.log("PASS: manual default, backup/restore/cancel, persistent toggle, navigation without sync, automatic upload/download, offline conflicts, mobile resolution, sign-out cleanup, legible toggle state (synthetic Firebase)")
} catch (error) {
  console.error(await page?.locator("body").innerText())
  console.error(await page?.locator("#header").ariaSnapshot())
  throw error
} finally {
  await browser?.close()
  await server.close()
}
