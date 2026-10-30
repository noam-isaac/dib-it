import assert from "node:assert/strict"

// A controlled checkbox settles after the asynchronous workspace lock completes.
// Playwright's check() asserts during the click itself, before that completion.
export const setChecked = async (locator, checked = true) => {
  if (await locator.isChecked() !== checked) await locator.click()
  const deadline = Date.now() + 10000
  while (await locator.isChecked() !== checked && Date.now() < deadline) await locator.page().waitForTimeout(10)
  assert.equal(await locator.isChecked(), checked, "checkbox must reflect the completed save")
}
