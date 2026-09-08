# Maintaining Dib It

Semester dates and the default semester come from Arazim's public `data/info.json`.
Course catalogs come from `data/courses-{semester}.json`; degree programs come from
`data/plans-{year}.json`. The application does not contain a `semesterInfo.tsx` file
or own those upstream feeds. `src/utilities.ts` defines the earliest offered semester.

Annual classification comes from the versioned public `annual-data` branch feed,
refreshed daily at 03:17 UTC by `.github/workflows/annual-data.yml`. The workflow
uses the existing TAU annual-only scraper, discovers all offered years, and
publishes only after every year succeeds. Refreshes do not modify `main` or deploy
the app; the data branch disables Vercel deployments. GitHub's workflow history
records failures. The repository maintainer owns failed-run investigation;
GitHub schedules can be delayed or disabled after repository inactivity, so check
the last successful run and the per-year verification dates.

The app validates version, source, dates, course IDs and group IDs before accepting
a feed. It retains missing years, rejects older per-year records, and uses the
last valid browser cache or bundled `src/annualGroups.json` when requests fail.
There is no arbitrary expiry that deletes selections: Settings shows the source
verification date and provides a retry. Edits in a year with no classification
remain pending, including removals, until the year can be classified. The pending
marker travels with JSON and Google backups.

To activate after merging the workflow into this fork's default branch, run
**Actions → Refresh annual-course data → Run workflow** and verify the public feed:
`https://raw.githubusercontent.com/noam-isaac/dib-it/annual-data/annual-groups.json`.
Deploy the app's feed-reading change once. Later data refreshes need no app release.
To reproduce a feed locally, run:
`python3 scripts/refresh-annual-courses.py --feed --output /tmp/annual-groups.json`.
The optional bundled fallback can still be refreshed with `bun run refresh:annual`
or `python3 scripts/refresh-annual-courses.py 2026`; a partial-year refresh retains
other years. Review and commit fallback changes explicitly.

See [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
and [Vercel deployment exclusion](https://vercel.com/docs/project-configuration/git-configuration).

This fork is maintained in `noam-isaac/dib-it`. See README for local setup,
verification, and preview routing. Merge and production publication are separate
release steps.

Browser regression servers use distinct Vite `cacheDir` directories. Keep test
caches separate from the interactive dev server: changing optimizer settings in a
shared cache can mix Mantine module instances and crash a running preview.
