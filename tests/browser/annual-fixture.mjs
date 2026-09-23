import annualFeed from "../fixtures/annual-feed.json" with { type: "json" }

// Most UI tests start with a validated cache. annual-feed.mjs covers a cold start.
export const prepareAnnualFeed = async page => {
  await page.route("**/data/annual-groups.json", route => route.fulfill({ json: annualFeed }))
  await page.addInitScript(feed => {
    if (!localStorage.getItem("Annual Course Registry"))
      localStorage.setItem("Annual Course Registry", JSON.stringify(feed))
  }, annualFeed)
}
