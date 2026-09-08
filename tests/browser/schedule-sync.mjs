import assert from "node:assert/strict"
import { chromium } from "playwright"
import { createServer } from "vite"

// Browser wiring check with synthetic auth/cloud data only; never contacts Firebase.
const stub = `
import { useEffect, useState } from 'react';
export const auth = { currentUser: { uid: 'test-user', displayName: 'Test', photoURL: null } };
export const firestore = {};
export const app = {};
const listeners = new Set(), authListeners = new Set();
let cloud, writes = 0, transactions = 0, offline = false;
const snapshot = () => ({ data: () => structuredClone(cloud), exists: () => cloud !== undefined, metadata: { fromCache: false, hasPendingWrites: false } });
const emit = () => listeners.forEach(fn => fn(snapshot()));
export const doc = () => ({});
export const getDoc = async () => { if (offline) throw new Error('Offline test'); return snapshot(); };
export const setDoc = async (_ref, value) => { if (offline) throw new Error('Offline test'); cloud = structuredClone(value); writes++; queueMicrotask(emit); };
export const onSnapshot = (_ref, _options, callback) => { listeners.add(callback); queueMicrotask(() => listeners.has(callback) && callback(snapshot())); return () => listeners.delete(callback); };
export const runTransaction = async (_db, callback) => {
  transactions++;
  if (offline) throw new Error('Offline test');
  let upload;
  const result = await callback({ get: async () => snapshot(), set: (_ref, data) => { upload = data; } });
  if (upload) { cloud = structuredClone(upload); writes++; queueMicrotask(emit); }
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
  get cloud() { return cloud; }, get writes() { return writes; }, get transactions() { return transactions; },
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
      if (/\/src\/components\/(GoogleScheduleSync|GoogleSaveButtons|Header)\.tsx$/.test(id))
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
    if (url.hostname === "127.0.0.1") return route.continue()
    if (url.hostname === "arazim-project.com") return route.fulfill({ json: url.pathname.endsWith("info.json")
      ? { currentSemester: "2026a", semesters: { "2026a": { startDate: "2025-10-26", endDate: "2026-01-25" } } }
      : url.pathname.includes("courses-") ? { "12345678": { name: "קורס בדיקה", faculty: "פקולטה/חוג", groups: [{ group: "01", lessons: [] }], exams: [] } } : {} })
    return route.abort()
  })
  await page.addInitScript(state => localStorage.setItem("Dib It", JSON.stringify(state)), initial)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await page.getByRole("button", { name: "למערכת השעות", exact: true }).click()
  const menu = async () => page.getByRole("button", { name: "פעולות", exact: true }).click()
  const toggle = () => page.getByRole("menuitemcheckbox", { name: "סנכרון אוטומטי עם גוגל", exact: true })
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.syncTest.transactions), 0, "sign-in must not enable sync")
  await menu()
  assert.equal(await toggle().getAttribute("aria-checked"), "false")
  await page.getByRole("menuitem", { name: "גיבוי בגוגל", exact: true }).click()
  await page.getByText("השמירה בגוגל בוצעה בהצלחה", { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.syncTest.cloud.plans[0].name), "בדיקה")
  const edit = name => page.evaluate(async name => {
    const { getWorkspace, setWorkspace } = await import("/src/models.ts")
    const workspace = getWorkspace()
    workspace.plans[0].name = name
    setWorkspace(workspace)
  }, name)
  await edit("שינוי ידני")
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.syncTest.cloud.plans[0].name), "בדיקה")
  await menu()
  await page.getByRole("menuitem", { name: "שחזור מגוגל", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "ביטול", exact: true }).click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].name), "שינוי ידני")
  await menu()
  await page.getByRole("menuitem", { name: "שחזור מגוגל", exact: true }).click()
  await page.getByRole("button", { name: "החלפת כל המערכות ושחזור", exact: true }).click()
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].name), "בדיקה")
  await page.evaluate(() => window.syncTest.offline(true))
  await menu()
  await page.getByRole("menuitem", { name: "גיבוי בגוגל", exact: true }).click()
  await page.getByText("שגיאה בשמירה בגוגל", { exact: true }).waitFor()
  await page.evaluate(() => window.syncTest.offline(false))
  await menu()
  await toggle().click()
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => window.syncTest.transactions > 0)
  assert.equal(await page.getByText("מסונכרן עם גוגל", { exact: true }).count(), 0)
  await page.waitForTimeout(1200)
  const beforeNavigation = await page.evaluate(() => window.syncTest.transactions)
  await page.getByRole("button", { name: "מבחנים", exact: true }).click()
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.syncTest.transactions), beforeNavigation, "tab changes do not contact cloud")
  await edit("עריכה מקומית")
  await page.waitForFunction(() => window.syncTest.cloud.plans[0].name === "עריכה מקומית")
  await page.evaluate(() => {
    const remote = structuredClone(window.syncTest.cloud)
    remote.plans[0].name = "מכשיר אחר"
    window.syncTest.remote(remote)
  })
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].name === "מכשיר אחר")
  await page.evaluate(() => window.syncTest.offline(true))
  await edit("עריכה ללא רשת")
  await page.getByText("המערכות נשמרו במכשיר. הסנכרון לגוגל לא הושלם.", { exact: true }).waitFor()
  await page.evaluate(() => {
    const remote = structuredClone(window.syncTest.cloud)
    remote.plans[0].name = "עריכה מרוחקת"
    window.syncTest.remote(remote)
    window.syncTest.offline(false)
  })
  await page.getByRole("button", { name: "בחירת המערכות לסנכרון", exact: true }).click()
  await page.getByRole("dialog").getByText("במכשיר: עריכה ללא רשת", { exact: true }).waitFor()
  await page.getByRole("button", { name: "החלפת המערכות במכשיר בעותק מגוגל", exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("Dib It")).plans[0].name === "עריכה מרוחקת")
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
  console.log("PASS: manual default, backup/restore/cancel, persistent toggle, navigation without sync, automatic upload/download, offline conflicts, mobile resolution, sign-out cleanup (synthetic Firebase)")
} catch (error) {
  console.error(await page?.locator("body").innerText())
  console.error(await page?.locator("#header").ariaSnapshot())
  throw error
} finally {
  await browser?.close()
  await server.close()
}
