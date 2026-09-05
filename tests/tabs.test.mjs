// Run with: node --experimental-strip-types --test tests/tabs.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { tabs, visibleTabs } from "../src/tabs.ts"

test("tab visibility preserves defaults, order, and access to Settings", () => {
  assert.deepEqual(visibleTabs([]), tabs)
  assert.deepEqual(
    visibleTabs(["practice", "study-plan"]).map(({ id }) => id),
    ["schedule", "exams", "guide", "settings"],
  )
  assert.deepEqual(
    visibleTabs(tabs.map(({ id }) => id)).map(({ id }) => id),
    ["settings"],
  )
  assert.deepEqual(visibleTabs(["unknown"]), tabs)
})
