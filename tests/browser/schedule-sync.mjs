import { prepareAnnualFeed } from "./annual-fixture.mjs"
import assert from "node:assert/strict"
import { chromium, firefox, webkit } from "playwright"
import { createServer } from "vite"

// Browser wiring check with synthetic auth/cloud data only; never contacts Firebase.
const stub = `
import { useEffect, useState } from 'react';
export const auth = { currentUser: { uid: 'test-user', displayName: 'נועם בעל שם משפחה ארוך במיוחד', photoURL: null } };
export const firestore = {};
export const app = {};
const listenerErrors = new Map();
const listeners = new Set(), authListeners = new Set();
export class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } static now() { return new Timestamp(Date.now()); } }
export const serverTimestamp = () => Date.now();
let cloud = window.__initialCloud ?? JSON.parse(sessionStorage.getItem('__syncCloud') ?? 'null') ?? undefined, writes = 0, transactions = 0, offline = false, holdApply, releaseApply, committed = false;
let holdRead, releaseRead, readWaiting = false, completedTransactions = 0;
const snapshot = () => ({ data: () => cloud ? { ...structuredClone(cloud), savedAt: new Timestamp(cloud.savedAt) } : undefined, exists: () => cloud !== undefined, metadata: { fromCache: false, hasPendingWrites: false } });
let pausedSnapshots = false, commitResponse, beforeNextCommit;
const emit = () => { if (!pausedSnapshots) listeners.forEach(fn => fn(snapshot())); };
export const doc = () => ({});
export const getDoc = async () => { if (offline) throw new Error('Offline test'); return snapshot(); };
export const getDocFromServer = getDoc;
export const setDoc = async (_ref, value) => { if (offline) throw new Error('Offline test'); cloud = structuredClone(value); writes++; queueMicrotask(emit); };
export const onSnapshot = (_ref, _options, callback, failure) => { listenerErrors.set(callback, failure); listeners.add(callback); queueMicrotask(() => listeners.has(callback) && callback(snapshot())); return () => { listeners.delete(callback); listenerErrors.delete(callback); }; };
export const runTransaction = async (_db, callback) => {
  transactions++;
  if (offline) throw new Error('Offline test');
  let upload;
  const result = await callback({
    get: async () => {
      const waiting = holdRead;
      holdRead = undefined;
      if (waiting) {
        readWaiting = true;
        await waiting;
        readWaiting = false;
      }
      return snapshot();
    },
    set: (_ref, data) => { upload = data; },
  });
  if (upload && beforeNextCommit) {
    cloud = structuredClone(beforeNextCommit);
    beforeNextCommit = undefined;
    queueMicrotask(emit);
    return runTransaction(_db, callback);
  }
  const response = upload ? commitResponse : undefined;
  if (upload) commitResponse = undefined;
  if (upload && response !== 'not-committed') { cloud = structuredClone(upload); writes++; queueMicrotask(emit); }
  if (upload && holdApply) { committed = true; await holdApply; holdApply = undefined; }
  if (response === 'retry') return runTransaction(_db, callback);
  if (response) throw Object.assign(new Error('Commit response lost'), { code: 'unavailable' });
  completedTransactions++;
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
  beforeNextCommit: value => { beforeNextCommit = value; },
  commitResponse: value => { commitResponse = value; },
  pauseSnapshots: value => { pausedSnapshots = value; if (!value) emit(); },
  holdNextRead: () => { holdRead = new Promise(resolve => { releaseRead = resolve; }); },
  releaseRead: () => releaseRead(),
  get readWaiting() { return readWaiting; },
  get completedTransactions() { return completedTransactions; },
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
  cacheDir: `node_modules/.vite-schedule-sync-${process.env.DIBIT_BROWSER ?? "chromium"}`,
  plugins: [
    {
      name: "synthetic-schedule-sync",
      resolveId(id) {
        if (id === "/test-sync-stub") return "\0test-sync-stub"
      },
      load(id) {
        if (id === "\0test-sync-stub") return stub
      },
      transform(code, id) {
        if (id.endsWith("/src/firebase.ts"))
          return 'export { app, auth, firestore } from "/test-sync-stub"'
        if (
          /\/src\/components\/(GoogleScheduleSync|GoogleSyncToggle|Header)\.tsx$/.test(
            id,
          ) ||
          id.endsWith("/src/googleWorkspace.ts")
        )
          return code
            .replaceAll('"firebase/firestore"', '"/test-sync-stub"')
            .replaceAll('"firebase/auth"', '"/test-sync-stub"')
            .replaceAll('"react-firebase-hooks/auth"', '"/test-sync-stub"')
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0 },
})
const initial = {
  semester: "2026a",
  tab: "schedule",
  plans: [
    {
      id: "first",
      name: "בדיקה",
      courses: { "2026a": [{ id: "12345678", groups: ["01"] }] },
    },
  ],
  activePlanId: "first",
}
let browser
let page
try {
  await server.listen()
  browser = await { chromium, firefox, webkit }[
    process.env.DIBIT_BROWSER ?? "chromium"
  ].launch()
  page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on("pageerror", (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text())
  })
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1" && !url.pathname.startsWith("/data/"))
      return route.continue()
    if (url.hostname === "127.0.0.1" && url.pathname.startsWith("/data/"))
      return route.fulfill({
        json: url.pathname.endsWith("info.json")
          ? {
              currentSemester: "2026a",
              semesters: {
                "2026a": { startDate: "2025-10-26", endDate: "2026-01-25" },
              },
            }
          : url.pathname.includes("courses-")
            ? {
                12345678: {
                  name: "קורס בדיקה",
                  faculty: "פקולטה/חוג",
                  groups: ["01", "02", "03"].map((group) => ({
                    group,
                    lessons: [],
                  })),
                  exams: [],
                },
                22222222: {
                  name: "קורס נוסף במכשיר",
                  groups: [{ group: "01", lessons: [] }],
                },
                33333333: {
                  name: "קורס נוסף בגוגל",
                  groups: [{ group: "01", lessons: [] }],
                },
              }
            : {},
      })
    return route.abort()
  })
  await page.addInitScript((state) => {
    if (!localStorage.getItem("Dib It"))
      localStorage.setItem("Dib It", JSON.stringify(state))
    Object.defineProperty(navigator, "locks", { value: undefined })
  }, initial)
  await prepareAnnualFeed(page)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  await page.getByRole("button", { name: "למערכת השעות", exact: true }).click()
  const menu = async () => {
    await page.getByRole("button", { name: "פעולות", exact: true }).click()
  }
  const toggle = () =>
    page.getByRole("menuitemcheckbox", {
      name: "סנכרון אוטומטי עם גוגל",
      exact: true,
    })
  const notice = page.getByRole("button", {
    name: "בחירת השינויים לשמירה",
    exact: true,
  })
  const dialog = page.getByRole("dialog")
  const submit = () =>
    dialog
      .getByRole("button", { name: "שמירה והמשך סנכרון", exact: true })
      .click()
  const openChoices = async () => {
    await notice.waitFor()
    await page
      .getByRole("button", { name: "בחירת השינויים לשמירה", exact: true })
      .click()
    await dialog.waitFor()
  }
  const setAutomatic = async (enabled) => {
    await menu()
    if ((await toggle().getAttribute("aria-checked")) !== String(enabled))
      await toggle().click()
    await menu()
    await page.waitForFunction(
      (enabled) => window.syncTest.listenerCount === (enabled ? 1 : 0),
      enabled,
    )
  }
  const loadHelpers = () =>
    page.evaluate(async () => {
      const { scheduleKey, sameScheduleContent } = await import(
        "/src/scheduleSync.ts"
      )
      window.__scheduleKey = scheduleKey
      window.__sameScheduleContent = sameScheduleContent
      const { withCatalogSourceOrder } = await import("/src/workspaceFormat.ts")
      window.__readCloudWorkspace = (copy) =>
        copy.catalogSources
          ? withCatalogSourceOrder(copy.workspace, copy.catalogSources)
          : copy.workspace
      window.__readLocalCopy = (
        await import("/src/localSchedule.ts")
      ).readLocalCopy
    })
  await loadHelpers()
  const waitForSynced = () =>
    page.waitForFunction(() => {
      const local = window.__readLocalCopy()
      return (
        window.syncTest.cloud &&
        window.__sameScheduleContent(
          local.workspace,
          window.__readCloudWorkspace(window.syncTest.cloud),
        ) &&
        local.sync?.base ===
          window.__scheduleKey(
            window.__readCloudWorkspace(window.syncTest.cloud),
          )
      )
    })
  const edit = (data) =>
    page.evaluate(async (data) => {
      const { getWorkspace, setWorkspace } = await import("/src/models.ts")
      const current = getWorkspace()
      setWorkspace({
        ...current,
        ...(data.theme ? { theme: data.theme } : {}),
        plans: current.plans.map((plan) => ({
          ...plan,
          ...(data.name ? { name: data.name } : {}),
          ...(data.group
            ? {
                courses: {
                  ...plan.courses,
                  "2026a": [
                    { ...plan.courses["2026a"][0], groups: [data.group] },
                  ],
                },
              }
            : {}),
        })),
      })
    }, data)
  const remoteEdit = (data) =>
    page.evaluate((data) => {
      const cloud = window.syncTest.cloud
      window.syncTest.remote({
        ...cloud,
        revision: cloud.revision + 1,
        savedAt: Date.now(),
        workspace: {
          ...cloud.workspace,
          ...(data.theme ? { theme: data.theme } : {}),
          plans: cloud.workspace.plans.map((plan) => ({
            ...plan,
            ...(data.name ? { name: data.name } : {}),
            ...(data.group
              ? {
                  courses: {
                    ...plan.courses,
                    "2026a": [
                      { ...plan.courses["2026a"][0], groups: [data.group] },
                    ],
                  },
                }
              : {}),
          })),
        },
      })
    }, data)
  const reset = async () => {
    await setAutomatic(false)
    await page.evaluate(async () => {
      const { normalizePlans } = await import("/src/plans.ts")
      const { setWorkspace } = await import("/src/models.ts")
      const { scheduleKey } = await import("/src/scheduleSync.ts")
      const workspace = normalizePlans({
        semester: "2026a",
        tab: "schedule",
        theme: "apple",
        courses: { "2026a": [{ id: "12345678", groups: ["01"] }] },
      })
      const base = {
        ...workspace,
        plans: workspace.plans.map((plan) => ({ ...plan, name: "Original" })),
      }
      setWorkspace(base)
      localStorage.removeItem("Dib It Pending Upload")
      localStorage.setItem(
        "Dib It Sync",
        JSON.stringify({
          uid: "test-user",
          base: scheduleKey(base),
          revision: 1,
          savedAt: 1,
        }),
      )
      window.syncTest.remote({
        protocol: 2,
        revision: 1,
        savedAt: 1,
        workspace: base,
      })
    })
  }
  const startConflict = async () => {
    await reset()
    await edit({ group: "02" })
    await remoteEdit({ group: "03" })
    await setAutomatic(true)
    await openChoices()
  }
  const localGroup = () =>
    dialog.getByRole("radio", { name: /במכשיר הזה:.*קבוצות 02/ })
  const remoteGroup = () =>
    dialog.getByRole("radio", { name: /בחשבון:.*קבוצות 03/ })
  const readCopies = () =>
    page.evaluate(() => ({
      local: JSON.parse(localStorage.getItem("Dib It")),
      cloud: window.__readCloudWorkspace(window.syncTest.cloud),
    }))

  const checkLayouts = async (name, action) => {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      if (action) {
        await action.scrollIntoViewIfNeeded()
        const bounds = await action.boundingBox()
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
          `${name}: action fits width ${viewport.width}`,
        )
        assert.ok(
          bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
          `${name}: action fits height ${viewport.height}`,
        )
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${name}: no horizontal overflow at ${viewport.width}`,
      )
      const header = page.locator("#header")
      assert.equal(
        await header.evaluate((el) => el.scrollHeight <= el.clientHeight),
        true,
        `${name}: account controls fit vertically at ${viewport.width}`,
      )
      const signOutLabel = header
        .getByRole("button", { name: /התנתק\/י/ })
        .locator(".mantine-Button-label")
      assert.equal(
        await signOutLabel.evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        `${name}: sign-out text is readable at ${viewport.width}`,
      )
      if (await dialog.count()) {
        assert.equal(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
          true,
          `${name}: dialog contents fit at ${viewport.width}`,
        )
      }
      if (process.env.DIBIT_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.DIBIT_SCREENSHOT_DIR}/${name}-${viewport.width}.png`,
        })
    }
    await page.setViewportSize({ width: 390, height: 844 })
  }

  await page.waitForTimeout(1200)
  assert.equal(
    await page.evaluate(() => window.syncTest.transactions),
    0,
    "sign-in does not change the sync preference",
  )
  await page
    .locator("#header")
    .getByText("הסנכרון כבוי", { exact: true })
    .waitFor()
  await menu()
  assert.equal(await toggle().getAttribute("aria-checked"), "false")
  assert.equal(
    await page
      .getByRole("menuitem", {
        name: /העלאת המערכות לגוגל|טעינת המערכות מגוגל|העברה ידנית/,
      })
      .count(),
    0,
  )
  await toggle().click()
  await page.keyboard.press("Escape")
  await waitForSynced()
  assert.equal(
    await dialog.count(),
    0,
    "creating a missing shared copy needs no decision",
  )
  assert.equal(await page.locator(".mantine-Notification-root").count(), 0)
  await page
    .locator("#header")
    .getByText("מעודכן בגוגל", { exact: true })
    .waitFor()
  if (process.env.DIBIT_SCREENSHOT_DIR) {
    await page.locator("#header").screenshot({
      path: `${process.env.DIBIT_SCREENSHOT_DIR}/sync-status-mobile.png`,
    })
  }
  await checkLayouts("synced")
  await page.evaluate(() => window.syncTest.holdApplication())
  await edit({ name: "Ordinary edit" })
  await page
    .locator("#header")
    .getByText("ממתין לסנכרון", { exact: true })
    .waitFor()
  await page.waitForFunction(() => window.syncTest.committed)
  assert.equal(
    await page
      .locator("#header")
      .getByText("מעודכן בגוגל", { exact: true })
      .count(),
    0,
  )
  await page.evaluate(() => window.syncTest.releaseApplication())
  await waitForSynced()
  await page
    .locator("#header")
    .getByText("מעודכן בגוגל", { exact: true })
    .waitFor()
  await remoteEdit({ name: "Continued on another device" })
  await waitForSynced()
  assert.equal(
    (await readCopies()).local.plans[0].name,
    "Continued on another device",
  )
  assert.equal(await dialog.count(), 0)
  // Harmless navigation is not a sync change.
  await page.waitForTimeout(1200)
  const beforeNavigation = await page.evaluate(() => window.syncTest.writes)
  await page.evaluate(async () => {
    const { updateDibIt } = await import("/src/models.ts")
    updateDibIt((current) => ({ ...current, tab: "practice" }))
    updateDibIt((current) => ({ ...current, tab: "schedule" }))
  })
  await page.waitForTimeout(1200)
  assert.equal(
    await page.evaluate(() => window.syncTest.writes),
    beforeNavigation,
  )
  console.log(
    "PASS: one setting, quiet ordinary saves, automatic device handoff, navigation without interruption",
  )

  await reset()
  await page.evaluate(async () => {
    const { normalizePlans } = await import("/src/plans.ts")
    const { setWorkspace } = await import("/src/models.ts")
    setWorkspace(normalizePlans({}))
    localStorage.removeItem("Dib It Sync")
  })
  await setAutomatic(true)
  await waitForSynced()
  assert.equal((await readCopies()).local.plans[0].name, "Original")
  assert.equal(
    await dialog.count(),
    0,
    "a blank new device loads the shared schedules directly",
  )
  const matchingWrites = await page.evaluate(() => window.syncTest.writes)
  await setAutomatic(false)
  await setAutomatic(true)
  await waitForSynced()
  assert.equal(
    await page.evaluate(() => window.syncTest.writes),
    matchingWrites,
  )
  assert.equal(await dialog.count(), 0)
  console.log(
    "PASS: a blank device loads automatically and matching copies enable without a write or decision",
  )

  for (const identicalOverlap of [false, true]) {
    await reset()
    await page.evaluate(async (identicalOverlap) => {
      const { getWorkspace, setWorkspace } = await import("/src/models.ts")
      const current = getWorkspace()
      const shared = identicalOverlap ? { shared: { name: "Identical" } } : {}
      const a = { one: { name: "One" }, ...shared },
        b = { two: { name: "Two" }, ...shared }
      setWorkspace({ ...current, customCourses: { a, b } })
      localStorage.removeItem("Dib It Sync")
      window.syncTest.remote({
        protocol: 3,
        catalogSources: ["b", "a"],
        revision: 2,
        savedAt: Date.now(),
        workspace: { ...current, customCourses: { b, a } },
      })
    }, identicalOverlap)
    const before = await page.evaluate(() => ({
      raw: localStorage.getItem("Dib It"),
      writes: window.syncTest.writes,
    }))
    await setAutomatic(true)
    await waitForSynced()
    await page
      .locator("#header")
      .getByText("מעודכן בגוגל", { exact: true })
      .waitFor()
    assert.equal(await notice.count(), 0)
    assert.equal(await dialog.count(), 0)
    assert.equal(
      await page.evaluate(() => localStorage.getItem("Dib It")),
      before.raw,
    )
    assert.equal(
      await page.evaluate(() => window.syncTest.writes),
      before.writes,
    )
  }
  console.log(
    "PASS: equivalent catalog order syncs on first connection without a prompt, cloud write or local replacement",
  )

  await reset()
  await edit({ name: "Local independent edit" })
  await remoteEdit({ group: "03" })
  await setAutomatic(true)
  await waitForSynced()
  assert.equal(
    (await readCopies()).local.plans[0].name,
    "Local independent edit",
  )
  assert.deepEqual(
    (await readCopies()).local.plans[0].courses["2026a"][0].groups,
    ["03"],
  )
  assert.equal(await dialog.count(), 0)
  await page.evaluate(() => window.syncTest.offline(true))
  await edit({ name: "Offline edit" })
  await page
    .getByRole("button", { name: "הסנכרון לא הושלם", exact: true })
    .waitFor()
  assert.equal(await dialog.count(), 0)
  await page.evaluate(() => window.syncTest.offline(false))
  await waitForSynced()
  assert.equal((await readCopies()).cloud.plans[0].name, "Offline edit")
  console.log(
    "PASS: independent changes combine and offline changes retry without a decision",
  )

  for (const catalogSide of ["local", "remote"]) {
    await reset()
    await page.evaluate(async (catalogSide) => {
      const { getWorkspace, setWorkspace } = await import("/src/models.ts")
      const base = getWorkspace()
      const catalog = {
        ...base,
        customCourses: {
          imported: {
            87654321: { name: "Independent custom course", groups: [] },
          },
        },
      }
      const selected = {
        ...base,
        plans: base.plans.map((plan) => ({
          ...plan,
          courses: { "2026a": [{ id: "12345678", groups: ["03"] }] },
        })),
      }
      setWorkspace(catalogSide === "local" ? catalog : selected)
      window.syncTest.remote({
        ...window.syncTest.cloud,
        revision: 2,
        workspace: catalogSide === "remote" ? catalog : selected,
      })
    }, catalogSide)
    await setAutomatic(true)
    await waitForSynced()
    const copies = await readCopies()
    for (const workspace of [copies.local, copies.cloud]) {
      assert.equal(
        workspace.customCourses.imported["87654321"].name,
        "Independent custom course",
      )
      assert.deepEqual(workspace.plans[0].courses["2026a"][0].groups, ["03"])
    }
    assert.equal(await notice.count(), 0)
    assert.equal(await dialog.count(), 0)
  }
  console.log(
    "PASS: unrelated catalog and course selections combine automatically in either direction",
  )

  for (const response of ["lost", "retry", "not-committed", "reload"]) {
    await reset()
    await edit({ group: "02" })
    await remoteEdit({ name: "Remote independent change" })
    await page.evaluate((response) => {
      window.syncTest.pauseSnapshots(true)
      window.syncTest.holdApplication()
      if (response !== "reload") window.syncTest.commitResponse(response)
    }, response)
    await setAutomatic(true)
    await page.waitForFunction(() => window.syncTest.committed)
    await edit({ group: "01" })
    assert.deepEqual(
      (await readCopies()).local.plans[0].courses["2026a"][0].groups,
      ["01"],
    )
    if (response === "reload") {
      await page.evaluate(() =>
        sessionStorage.setItem(
          "__syncCloud",
          JSON.stringify(window.syncTest.cloud),
        ),
      )
      await page.reload()
      await loadHelpers()
    } else {
      await page.evaluate(() => window.syncTest.releaseApplication())
      if (response !== "retry") {
        await page
          .getByRole("button", { name: "הסנכרון לא הושלם", exact: true })
          .waitFor()
        await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      }
    }
    await waitForSynced()
    const copies = await readCopies()
    assert.deepEqual(copies.local.plans[0].courses["2026a"][0].groups, ["01"])
    assert.deepEqual(copies.cloud.plans[0].courses["2026a"][0].groups, ["01"])
    assert.equal(copies.local.plans[0].name, "Remote independent change")
    assert.equal(await notice.count(), 0)
    assert.equal(await dialog.count(), 0)
    assert.equal(
      await page.evaluate(() => localStorage.getItem("Dib It Pending Upload")),
      null,
    )
    await page.evaluate(() => window.syncTest.pauseSnapshots(false))
  }
  console.log(
    "PASS: lost responses, transaction retries, failed commits and reloads preserve a newer undo automatically",
  )

  await reset()
  await edit({ group: "02" })
  await page.evaluate(() => {
    const cloud = window.syncTest.cloud
    window.syncTest.beforeNextCommit({
      ...cloud,
      revision: cloud.revision + 1,
      savedAt: Date.now(),
      workspace: {
        ...cloud.workspace,
        plans: cloud.workspace.plans.map((plan) => ({
          ...plan,
          name: "Concurrent independent rename",
        })),
      },
    })
  })
  await setAutomatic(true)
  await waitForSynced()
  assert.equal(
    (await readCopies()).local.plans[0].name,
    "Concurrent independent rename",
  )
  assert.deepEqual(
    (await readCopies()).cloud.plans[0].courses["2026a"][0].groups,
    ["02"],
  )
  assert.equal(await notice.count(), 0)
  console.log(
    "PASS: another device winning the transaction still merges independent edits automatically",
  )

  // No write may be sent unless its recovery ancestor can be retained first.
  await reset()
  await edit({ group: "02" })
  const beforeBlockedUpload = await page.evaluate(() => window.syncTest.writes)
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === "Dib It Pending Upload") {
        Storage.prototype.setItem = original
        throw new DOMException("Quota exceeded", "QuotaExceededError")
      }
      return original.call(this, key, value)
    }
  })
  await setAutomatic(true)
  await page
    .getByRole("button", { name: "הסנכרון לא הושלם", exact: true })
    .click()
  assert.equal(
    await page.evaluate(() => window.syncTest.writes),
    beforeBlockedUpload,
  )
  assert.deepEqual(
    (await readCopies()).local.plans[0].courses["2026a"][0].groups,
    ["02"],
  )
  assert.deepEqual(
    (await readCopies()).cloud.plans[0].courses["2026a"][0].groups,
    ["01"],
  )
  await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click()
  await waitForSynced()
  console.log(
    "PASS: unavailable local recovery storage blocks the upload before changing Google",
  )

  // A failed local application must retain the committed merge's ancestor.
  await reset()
  await edit({ theme: "google" })
  await remoteEdit({ name: "Remote edit during merge" })
  await page.evaluate(() => {
    window.syncTest.pauseSnapshots(true)
    window.syncTest.holdApplication()
  })
  await setAutomatic(true)
  await page.waitForFunction(() => window.syncTest.committed)
  await edit({ theme: "apple" })
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === "Dib It") {
        Storage.prototype.setItem = original
        throw new DOMException("Quota exceeded", "QuotaExceededError")
      }
      return original.call(this, key, value)
    }
    window.syncTest.offline(true)
    window.syncTest.releaseApplication()
  })
  await page
    .getByRole("button", { name: "הסנכרון לא הושלם", exact: true })
    .click()
  await checkLayouts(
    "save-error",
    page.getByRole("button", { name: "ניסיון נוסף", exact: true }),
  )
  await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click()
  await page.evaluate(() => window.syncTest.offline(false))
  await waitForSynced()
  await page.evaluate(() => window.syncTest.pauseSnapshots(false))
  assert.equal((await readCopies()).local.theme, "apple")
  assert.equal((await readCopies()).cloud.theme, "apple")
  assert.equal(
    (await readCopies()).local.plans[0].name,
    "Remote edit during merge",
  )
  // The storage error notification belongs to this deliberately failed write.
  for (const close of await page
    .locator(".mantine-Notification-closeButton")
    .all())
    await close.click()
  await page.locator(".mantine-Notification-root").waitFor({ state: "hidden" })
  console.log(
    "PASS: a failed local merge application cannot overwrite a newer undo on retry",
  )

  // Fail after the primary replacement, including the fallback receipt write.
  for (const recovery of ["same-tab-undo", "reload-undo", "reload-unchanged"]) {
    await reset()
    await edit({ group: "02" })
    await remoteEdit({ name: "Remote rename" })
    await page.evaluate(() => {
      window.syncTest.pauseSnapshots(true)
      window.__originalSetItem = Storage.prototype.setItem
      let applied = false
      Storage.prototype.setItem = function (key, value) {
        if (applied && key === "Dib It Sync")
          throw new DOMException("Receipt unavailable", "QuotaExceededError")
        window.__originalSetItem.call(this, key, value)
        if (key === "Dib It") applied = true
      }
    })
    await setAutomatic(true)
    await page
      .getByRole("button", { name: "הסנכרון לא הושלם", exact: true })
      .waitFor()
    assert.equal((await readCopies()).local.plans[0].name, "Remote rename")
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("Dib It Sync")).base,
      ),
      "history-unavailable",
    )
    await setAutomatic(false)
    await page.evaluate(
      () => (Storage.prototype.setItem = window.__originalSetItem),
    )
    if (recovery !== "reload-unchanged") await edit({ name: "Original" })
    if (recovery.startsWith("reload")) {
      await page.evaluate(() =>
        sessionStorage.setItem(
          "__syncCloud",
          JSON.stringify(window.syncTest.cloud),
        ),
      )
      await page.reload()
      await loadHelpers()
    }
    await setAutomatic(true)
    if (recovery === "reload-undo") {
      await notice.waitFor()
      assert.equal(
        await dialog.count(),
        0,
        "uncertain recovery does not open a popup",
      )
      assert.equal((await readCopies()).local.plans[0].name, "Original")
      assert.equal((await readCopies()).cloud.plans[0].name, "Remote rename")
      await openChoices()
      await dialog
        .getByRole("radio", { name: "המערכות במכשיר הזה", exact: true })
        .check()
      await dialog
        .getByRole("button", {
          name: "שימוש במערכות האלה בכל המכשירים",
          exact: true,
        })
        .click()
    }
    await waitForSynced()
    const name = recovery === "reload-unchanged" ? "Remote rename" : "Original"
    assert.equal((await readCopies()).local.plans[0].name, name)
    assert.equal((await readCopies()).cloud.plans[0].name, name)
    assert.deepEqual(
      (await readCopies()).local.plans[0].courses["2026a"][0].groups,
      ["02"],
    )
    assert.equal(await notice.count(), 0)
    await page.evaluate(() => window.syncTest.pauseSnapshots(false))
  }
  console.log(
    "PASS: failed acknowledgements preserve undos across retries and reloads; matching recovery needs no choice",
  )

  await reset()
  await page.evaluate(async () => {
    const { getWorkspace, setWorkspace } = await import("/src/models.ts")
    const { scheduleKey } = await import("/src/scheduleSync.ts")
    const current = getWorkspace()
    const base = {
      ...current,
      plans: current.plans.map((plan) => ({
        ...plan,
        courses: {
          "2026a": ["12345678", "22222222", "33333333"].map((id) => ({
            id,
            groups: ["01"],
          })),
        },
      })),
    }
    localStorage.setItem(
      "Dib It Sync",
      JSON.stringify({
        uid: "test-user",
        base: scheduleKey(base),
        revision: 1,
      }),
    )
    setWorkspace({
      ...base,
      plans: base.plans.map((plan) => ({
        ...plan,
        courses: {
          "2026a": [plan.courses["2026a"][1], plan.courses["2026a"][0]],
        },
      })),
    })
    window.syncTest.remote({
      protocol: 2,
      revision: 2,
      savedAt: Date.now(),
      workspace: {
        ...base,
        plans: base.plans.map((plan) => ({
          ...plan,
          courses: {
            "2026a": [
              { ...plan.courses["2026a"][2], color: "#ff0000" },
              plan.courses["2026a"][0],
              plan.courses["2026a"][1],
            ],
          },
        })),
      },
    })
  })
  await setAutomatic(true)
  await openChoices()
  assert.equal(await dialog.getByRole("radio").count(), 2)
  await dialog.getByRole("radio").nth(1).check()
  assert.equal(
    await dialog.getByRole("radio").count(),
    4,
    "retaining the course reveals its ordering choice",
  )
  await dialog.getByRole("radio").nth(2).check()
  await submit()
  await waitForSynced()
  assert.deepEqual(
    (await readCopies()).local.plans[0].courses["2026a"].map(
      (course) => course.id,
    ),
    ["22222222", "12345678", "33333333"],
  )
  assert.equal(
    (await readCopies()).cloud.plans[0].courses["2026a"][2].color,
    "#ff0000",
  )
  console.log(
    "PASS: deletion and ordering decisions remain visible and submit together",
  )

  await startConflict()
  assert.equal(await dialog.getByRole("radio").count(), 2)
  assert.equal(
    await dialog
      .getByText(/מה לשמור\?|אפשרויות החלפה|תוצאת המיזוג|רענון ההשוואה/)
      .count(),
    0,
  )
  assert.equal(
    await dialog
      .getByRole("button", { name: "שמירה והמשך סנכרון" })
      .isDisabled(),
    true,
  )
  const saveBounds = await dialog
    .getByRole("button", { name: "שמירה והמשך סנכרון" })
    .boundingBox()
  assert.ok(
    saveBounds.y + saveBounds.height <= 844,
    "decision action stays visible on mobile",
  )
  if (process.env.DIBIT_SCREENSHOT_DIR) {
    await page.screenshot({
      path: `${process.env.DIBIT_SCREENSHOT_DIR}/simple-sync-choice-mobile.png`,
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({
      path: `${process.env.DIBIT_SCREENSHOT_DIR}/simple-sync-choice-desktop.png`,
    })
    await page.setViewportSize({ width: 390, height: 844 })
  }
  await remoteGroup().check()
  await checkLayouts(
    "conflict",
    dialog.getByRole("button", { name: "שמירה והמשך סנכרון", exact: true }),
  )
  await submit()
  await waitForSynced()
  await dialog.waitFor({ state: "hidden" })
  assert.deepEqual(
    (await readCopies()).local.plans[0].courses["2026a"][0].groups,
    ["03"],
  )
  assert.equal(await page.locator(".mantine-Notification-root").count(), 0)
  await edit({ name: "After decision" })
  await waitForSynced()
  console.log(
    "PASS: a real conflict asks only about the competing values and sync continues after one decision",
  )

  await startConflict()
  await edit({ name: "Local name" })
  await remoteEdit({ name: "Remote name" })
  await dialog
    .getByRole("radio", { name: "במכשיר הזה: Local name", exact: true })
    .waitFor()
  await localGroup().check()
  await dialog
    .getByRole("radio", { name: "במכשיר הזה: Local name", exact: true })
    .check()
  await remoteEdit({ theme: "google" })
  await page.waitForTimeout(1200)
  assert.equal(
    await localGroup().isChecked(),
    true,
    "unrelated updates keep the decision",
  )
  await remoteEdit({ group: "01" })
  // A reverted remote group stops competing and no longer needs an answer.
  await remoteGroup().waitFor({ state: "hidden" })
  assert.equal(
    await dialog
      .getByRole("radio", { name: "במכשיר הזה: Local name", exact: true })
      .isChecked(),
    true,
  )
  await submit()
  await waitForSynced()
  assert.equal((await readCopies()).cloud.plans[0].name, "Local name")
  assert.equal((await readCopies()).cloud.theme, "google")
  console.log(
    "PASS: live decisions retain unaffected answers and remove choices that no longer conflict",
  )

  await startConflict()
  await remoteGroup().check()
  await page.evaluate(() => window.syncTest.offline(true))
  await submit()
  await page
    .getByRole("button", { name: "הסנכרון לא הושלם", exact: true })
    .waitFor()
  await edit({ name: "Edited while waiting" })
  await page.evaluate(() => window.syncTest.offline(false))
  await waitForSynced()
  assert.equal((await readCopies()).cloud.plans[0].name, "Edited while waiting")
  assert.deepEqual(
    (await readCopies()).local.plans[0].courses["2026a"][0].groups,
    ["03"],
  )
  assert.equal(await dialog.count(), 0)
  console.log(
    "PASS: an approved decision survives a connection failure without asking again",
  )

  await startConflict()
  await localGroup().check()
  await page.evaluate(() => window.syncTest.holdNextRead())
  await submit()
  await page.waitForFunction(() => window.syncTest.readWaiting)
  await remoteEdit({ group: "01" })
  await remoteEdit({ group: "01", name: "New remote change" })
  await page.evaluate(() => window.syncTest.releaseRead())
  await waitForSynced()
  assert.deepEqual(
    (await readCopies()).cloud.plans[0].courses["2026a"][0].groups,
    ["02"],
  )
  assert.equal((await readCopies()).local.plans[0].name, "New remote change")
  console.log(
    "PASS: transaction rechecks use the latest independent changes instead of a reviewed snapshot",
  )

  await startConflict()
  await remoteGroup().check()
  await page.evaluate(() => window.syncTest.holdApplication())
  await submit()
  await page.waitForFunction(() => window.syncTest.committed)
  await edit({ group: "01" })
  await page.evaluate(() => window.syncTest.releaseApplication())
  await notice.waitFor()
  assert.deepEqual(
    (await readCopies()).local.plans[0].courses["2026a"][0].groups,
    ["01"],
    "a new competing edit survives the pending response",
  )
  assert.deepEqual(
    (await readCopies()).cloud.plans[0].courses["2026a"][0].groups,
    ["03"],
  )
  assert.equal(await dialog.count(), 0, "a new choice never opens a popup")
  console.log(
    "PASS: a competing edit during a committed save is preserved and waits for a genuine choice",
  )

  await startConflict()
  await page.evaluate(() => {
    window.syncTest.pauseSnapshots(true)
    window.syncTest.holdApplication()
  })
  await edit({ group: "03", theme: "google" })
  await page.waitForFunction(() => window.syncTest.committed)
  await edit({ theme: "apple" })
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("Dib It Sync")).revision,
    ),
    1,
  )
  await page.evaluate(() => {
    window.syncTest.releaseApplication()
    window.syncTest.pauseSnapshots(false)
  })
  await waitForSynced()
  await dialog.waitFor({ state: "hidden" })
  assert.equal((await readCopies()).local.theme, "apple")
  assert.equal((await readCopies()).cloud.theme, "apple")
  console.log(
    "PASS: lagging snapshots and an open choice cannot overwrite an undo during automatic merge",
  )

  await reset()
  await setAutomatic(true)
  await waitForSynced()
  await page.evaluate(() => window.syncTest.holdApplication())
  await edit({ name: "Committed before stop" })
  await page.waitForFunction(() => window.syncTest.committed)
  await setAutomatic(false)
  await edit({ name: "Original" })
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === "Dib It Sync") {
        Storage.prototype.setItem = original
        throw new DOMException("Quota exceeded", "QuotaExceededError")
      }
      return original.call(this, key, value)
    }
    window.syncTest.releaseApplication()
  })
  await setAutomatic(true)
  await waitForSynced()
  assert.equal((await readCopies()).local.plans[0].name, "Original")
  assert.equal((await readCopies()).cloud.plans[0].name, "Original")
  console.log(
    "PASS: stopped upload and failed receipt recovery preserve a local undo",
  )

  await startConflict()
  await page.evaluate(() => window.syncTest.failListener())
  await remoteEdit({ group: "02" })
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await waitForSynced()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.syncTest.listenerCount), 1)
  console.log(
    "PASS: reconnect recovers the one listener and closes a resolved decision",
  )

  await reset()
  await edit({ name: "Existing device schedules" })
  await remoteEdit({ name: "Existing account schedules" })
  await page.evaluate(() => localStorage.removeItem("Dib It Sync"))
  await setAutomatic(true)
  await openChoices()
  await dialog
    .getByRole("radio", { name: "המערכות במכשיר הזה", exact: true })
    .check()
  await remoteEdit({ name: "Updated account schedules" })
  await dialog
    .getByText("Updated account schedules", { exact: true })
    .first()
    .waitFor()
  assert.equal(
    await dialog
      .getByRole("button", {
        name: "שימוש במערכות האלה בכל המכשירים",
        exact: true,
      })
      .isDisabled(),
    true,
    "whole-copy consent cannot carry over to new contents",
  )
  await dialog
    .getByRole("radio", { name: "המערכות שכבר מסונכרנות בחשבון", exact: true })
    .check()
  const wholeSetAction = dialog.getByRole("button", {
    name: "שימוש במערכות האלה בכל המכשירים",
    exact: true,
  })
  const wholeSetBounds = await wholeSetAction.boundingBox()
  assert.ok(
    wholeSetBounds.x >= 0 && wholeSetBounds.x + wholeSetBounds.width <= 390,
  )
  assert.ok(wholeSetBounds.y + wholeSetBounds.height <= 844)
  if (process.env.DIBIT_SCREENSHOT_DIR) {
    await dialog.screenshot({
      path: `${process.env.DIBIT_SCREENSHOT_DIR}/whole-set-choice-mobile.png`,
    })
  }
  await checkLayouts("whole-set", wholeSetAction)
  await wholeSetAction.click()
  await waitForSynced()
  assert.equal(
    (await readCopies()).local.plans[0].name,
    "Updated account schedules",
  )
  console.log(
    "PASS: unrelated first-time schedules require one explicit choice, checked against current contents",
  )

  // File recovery remains separate, with an explicit confirmation before replacing schedules.
  await menu()
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "גיבוי לקובץ", exact: true }).click(),
  ])
  const chunks = []
  for await (const chunk of await backup.createReadStream()) chunks.push(chunk)
  const backupBytes = Buffer.concat(chunks)
  await edit({ name: "After file backup" })
  await waitForSynced()
  await menu()
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: "שחזור מקובץ", exact: true }).click(),
  ])
  await chooser.setFiles({
    name: "dibit.json",
    mimeType: "application/json",
    buffer: backupBytes,
  })
  await dialog
    .getByText(
      "כשהסנכרון פעיל, השחזור יסתנכרן גם לגוגל ולשאר המכשירים — כולל מחיקות ושינויים בבחירות הקורסים.",
      { exact: true },
    )
    .waitFor()
  const restoreAction = dialog.getByRole("button", {
    name: "החלפת כל המערכות ושחזור",
    exact: true,
  })
  await checkLayouts("file-restore", restoreAction)
  await restoreAction.click()
  await waitForSynced()
  assert.equal(
    (await readCopies()).cloud.plans[0].name,
    "Updated account schedules",
  )
  await page.getByRole("button", { name: /התנתק\/י/ }).click()
  await page.waitForFunction(() => window.syncTest.listenerCount === 0)
  assert.equal(await dialog.count(), 0)
  assert.equal(
    await page.evaluate(() => localStorage.getItem("Automatic Google Sync")),
    "true",
  )
  assert.deepEqual(errors, [])
  console.log(
    "PASS: existing file backup/restore syncs the restored schedules; sign-out stops the controller",
  )
} catch (error) {
  console.error(
    "UI at failure:",
    await page
      ?.locator("body")
      .innerText()
      .catch(() => "unavailable"),
  )
  await page
    ?.screenshot({ path: "/private/tmp/dibit-simple-failure.png" })
    .catch(() => {})
  throw error
} finally {
  await browser?.close()
  await server.close()
}
