// Architectural experiment, independent of Dib It. Run with "locks" or "idb".
// Counts are deliberately simultaneous stress results, not ordinary-use probabilities.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { chromium, firefox, webkit } from "playwright"

const mode = process.argv[2] ?? "locks"
assert.ok(["locks", "idb"].includes(mode))
const trials = mode === "locks" ? 100 : 200
const server = createServer((_, response) => response.end("<!doctype html><title>Storage boundary probe</title>"))
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch()
    try {
      const context = await browser.newContext()
      const pages = await Promise.all([context.newPage(), context.newPage()])
      const [a, b] = pages
      await Promise.all(pages.map(page => page.goto(`http://127.0.0.1:${server.address().port}`)))
      let lost = 0
      if (mode === "locks") {
        for (let trial = 0; trial < trials; trial++) {
          await a.evaluate(() => localStorage.setItem("record", JSON.stringify({ old: true })))
          await b.waitForFunction(() => JSON.parse(localStorage.getItem("record")).old)
          await b.evaluate(() => { window.release = null; void navigator.locks.request("store", () => new Promise(resolve => { window.release = resolve })) })
          await b.waitForFunction(() => window.release)
          await b.evaluate(() => { window.write = navigator.locks.request("store", () => localStorage.setItem("record", JSON.stringify({ restored: true }))) })
          await b.waitForFunction(async () => (await navigator.locks.query()).pending.length === 1)
          await a.evaluate(() => { window.write = navigator.locks.request("store", () => {
            const current = JSON.parse(localStorage.getItem("record"))
            localStorage.setItem("record", JSON.stringify({ ...current, edited: true }))
            return current
          }) })
          await a.waitForFunction(async () => (await navigator.locks.query()).pending.length === 2)
          await b.evaluate(() => window.release())
          await b.evaluate(() => window.write)
          const seen = await a.evaluate(() => window.write)
          if (!seen.restored) { lost++; if (lost === 1) console.log(name, "first stale read", trial, seen) }
        }
      } else {
        await Promise.all(pages.map(page => page.evaluate(() => new Promise((resolve, reject) => {
          const open = indexedDB.open("probe", 1)
          open.onupgradeneeded = () => open.result.createObjectStore("records")
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result
            window.update = (change, abort = false) => new Promise((resolve, reject) => {
              const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records")
              const read = store.get("workspace")
              let next
              read.onsuccess = () => { next = change(read.result); store.put(next, "workspace"); if (abort) tx.abort() }
              tx.oncomplete = () => resolve(next)
              tx.onabort = () => reject(tx.error ?? new Error("Aborted"))
            })
            resolve()
          }
        }))))
        for (let trial = 0; trial < trials; trial++) {
          await a.evaluate(() => window.update(() => ({})))
          const at = Date.now() + 15
          await Promise.all(pages.map((page, index) => page.evaluate(({ at, index }) => new Promise((resolve, reject) => setTimeout(() => {
            window.update(current => ({ ...current, [index]: true })).then(resolve, reject)
          }, Math.max(0, at - Date.now()))), { at, index })))
          const saved = await a.evaluate(() => window.update(current => current))
          if (!saved[0] || !saved[1]) lost++
        }
        assert.equal(await a.evaluate(async () => {
          try { await window.update(() => ({ bad: true }), true); return false } catch { return true }
        }), true)
        assert.deepEqual(await b.evaluate(() => window.update(current => ({ ...current, afterFailure: true }))), { 0: true, 1: true, afterFailure: true })
      }
      console.log(JSON.stringify({ mode, browser: name, version: browser.version(), lost, trials, ...(mode === "idb" ? { abortAndRecovery: "passed" } : {}) }))
    } finally { await browser.close() }
  }
} finally { server.close() }
