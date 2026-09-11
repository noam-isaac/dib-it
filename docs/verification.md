# UI and export verification

## Product review decisions (2026-09-11)

- Timetable exports: PDF prints the existing on-screen timetable, fitted to a
  landscape page with the shared hour-height CSS variable. PNG captures that same
  element at twice its displayed resolution, including its current theme and
  light/dark appearance. There is no separate export renderer, heading or legend.
  The image encoder loads only when exporting; no schedule data is uploaded.
  User requested the shared design on the site and exports, with hour labels on
  the right. The grid now runs RTL; day ordering and lesson placement are retained.
  Chromium, Firefox and WebKit checks assert this on screen and in print, and the
  updated landscape PDF was rendered and visually inspected.
  Validation: `bun run check` passed (83 unit tests, lint, build, all nine Chromium
  suites and scraper self-test). Firefox/WebKit print and PNG checks also passed.
  Rendered desktop/mobile PDFs were visually inspected: the 08:00–20:00 timetable
  fits one landscape page with all six Hebrew course titles. PNG checks cover full
  element dimensions, rendered content, unchanged workspace and encoder-failure
  recovery. PNG follows screen density, so compact mobile text wraps as on the site.
  `bun.lock` adds only `html-to-image@1.11.13`; existing versions are unchanged.
- Footer/contact links and guide/Word-export wording: user approved keeping them
  as they are, including Arazim attribution, fork feedback, license and export guidance.
- Introduction: user reviewed the current popup and approved keeping both its
  automatic first-visit display and the footer link for reopening it. No behavior
  change is needed.
- Mobile course list: user requested removing the show/hide control. Removed the
  button, collapse state and related CSS; course cards remain visible at all widths.
  Exam-search and timetable navigation retain scrolling and group-control focus.
  Lint, production build and the existing Chromium interaction suite passed,
  including mobile focus for existing and newly added courses.

## Reconciled review fixes and toolchain (2026-09-11)

Reconciles the complete local WIP onto `c1af459`, retaining PR #19's `essential`
recovery contract and preference-only reset, and PR #20's required `validate` job.

- R02/R03: retire obsolete annual classifications safely and limit pending-operation
  blocking to the affected course/year, preserving unrelated reconciliation.
- R05: reveal the collapsed mobile course list and focus the group checkbox from
  exam search; timetable navigation shares the same helper.
- R06/R07: reconnect failed listeners without hiding their failure behind successful
  writes; check cloud document size/shape in both upload paths and pause permanent
  payload retries. Local data and file backups remain available.
- R09: intercept or abort every external request in the remaining synthetic suites;
  non-auth test servers explicitly disable Google configuration.
- R11/R12: count only lessons on supported timetable days and preserve user-selected
  plan names through normalization.
- R13–R15: reuse the search index, remove Sidebar's duplicate subscription and the
  unused workspace writer, and exercise production plan updates instead of a
  test-only annual-sync wrapper.
- R01 enhancement: validate optional preference types at the shared read boundary,
  including storage events, while retaining the merged `essential` flag.
- R04 clarification: explicitly identify scheduling-only Lautman entries omitted from
  the Word form, while preserving the previously merged export fixes.
- Bun remains authoritative. Local Bun 1.4.2 was installed and verified in a fresh
  shell; `package.json` records that version and CI reads it, with Node 22 for browser
  scripts. Normal setup uses installed `bun`/`bunx` directly, without a temporary
  pnpm runner. The Firebase CLI launcher was verified; local Node remains 25.9.0.
  No alternate lockfile or duplicate CI workflow is introduced. The existing
  notification-animation polling is retained.

Local validation: 83 unit tests, lint, production build, nine Chromium browser
suites, and the annual scraper self-test. Firestore emulator tests were not run:
Java is unavailable and that separate check was excluded from this task. No live
Google account data was used.

## Production release of the merged recovery and CI fixes (2026-09-11)

Deployed clean fork revision `c1af459f86790ed7e95b89c0c80d18846d7495e5`, after successful
[Validate run 34573556072](https://github.com/noam-isaac/dib-it/actions/runs/34573556072)
and a clean frozen install/build. Deployment `dpl_B3twMYAqXLgbE36tRVxmTXFHEBfh` is READY:
https://dib-i5khly0dk-noamisaacs-projects.vercel.app.

Both https://dib-it.vercel.app and https://dib-it.noam-isaac.com serve the new
`index-h3sv2pcp.js` bundle. Fresh mobile browser contexts verified the actions menu,
the new “איפוס העדפות התצוגה” recovery button, and preservation of a synthetic raw
workspace after that reset. Vercel used its managed Bun 1.3.14 with the same frozen
lockfile (Mantine 8.0.2); this is dependency-version parity, not identical Bun binaries.
Branch protection was enabled and read back with required `validate`, strict status
checks, administrator enforcement, and force pushes/deletions disabled.

## Recovery from a corrupt display preference (2026-09-11)

Fixes review finding R01 (P1). `getLocalStorage` parsed every stored value with a bare
`JSON.parse`, so one unreadable preference crashed the whole app to the recovery screen,
whose only exit deleted the user's schedules, left the corrupt key in place and returned
to the same screen.

- Non-essential values reset themselves at the read boundary and return their default.
  The workspace passes `essential: true` and still surfaces corruption, because silently
  discarding a schedule would be worse than the crash.
- The cross-tab storage listener no longer parses untrusted input unguarded.
- Recovery leads with "איפוס העדפות התצוגה", which clears only the keys listed in
  `src/preferences.ts`. Schedules and unrelated origin storage are preserved. Deleting
  schedules remains available but is no longer the only option.
- The recovery download is deliberately still the raw workspace so it stays restorable
  through the existing שחזור flow.

Reproduced in Chromium before the change by setting `Compact View` to `broken-json`: crash,
recovery download omitting the failing value, schedule deleted on reset, corrupt key
retained, error screen returned. After the change: no crash, key healed, schedule intact,
unrelated storage untouched; a corrupt workspace still reaches recovery, and the
preference reset there preserves both it and unrelated storage. Both cases are now in the
existing recovery test in `tests/browser/dx-regressions.mjs`, which previously covered only
an invalid workspace. 76 unit tests, ESLint, the TypeScript/Vite build and all nine browser
suites pass. The `Sidebar Compact` key shares the same shape and is covered by the same
read-boundary change; it was not separately reproduced.


## Word registration export validation (2026-09-09)

Fixes issue #14. The export previously refused to run over values the dialog never asks the
student for: `department` (`1821`), `framework` (`999`), `degree` and the `registeringDepartment`
derived from the course-number prefix. A value that did not fit the printed boxes produced
`יש להזין N ספרות` and aborted the whole download.

- Blocking errors are now limited to what the student can act on in the dialog: a missing or
  over-long name, control characters or broken Unicode in the name, and a nine-digit ID.
  Template SHA256, byte-slot marker and 14-row checks are unchanged.
- Preset and catalog-derived boxed fields that do not fit are left blank for completion in Word,
  which is what the dialog already promises. Catalog text with control characters is cleaned, and
  a catalog course name longer than its 160-unit row is shortened with an ellipsis. Student text
  is never rewritten silently.
- Groups whose course number or group number cannot fit the boxes are excluded from the form and
  reported, instead of failing the export. The dialog marks them `לא בטופס`, explains why above
  the table, and the success notification lists every skipped group and shortened name.
- `createRegistrationDownload` returns those notes; the notification turns yellow and stops
  auto-closing whenever anything was skipped or shortened.
- `registrationRowFitsForm` lives in `src/registration.ts` so the dialog can use it without
  pulling the JSZip export module into the main bundle. `registrationDocument` remains a lazy
  chunk. The submit button's decorative icon is now `aria-hidden`; its glyph had been leaking
  into the button's accessible name.

Verified with 76 passing unit tests, ESLint, the TypeScript/Vite build and the full browser
suite. `tests/browser/registration-form.mjs` reproduces the reported failure end to end: a
catalog course number the boxes cannot hold is flagged, skipped, reported and still produces a
downloaded DOC, while the student's own ID is still refused at the field. No document bytes
outside the allocated slots changed; the retained original DOC and its hashes are untouched.
Native Word rendering of the shortened-name case was not re-inspected.

Earlier switch-test runs used inconsistent Mantine versions (8.3.18 versus 8.0.2).
The current test clicks the visible switch root on the dependency baseline in `bun.lock`.
There is no pnpm project lockfile. Use the frozen Bun installation documented in
[Developing](../README.md#developing) before comparing test results.


## Schedule context and restore flow (2026-09-07)

Based on merged fork revision `dea5510e846f5cbaa4a80e468dc8c9c001392ffd`. The active schedule name is visible above the semester selector, opens the existing switcher, and accompanies the Word export preview. File and Google restore share validation and an explicit confirmation listing incoming plans, with a recovery-backup download before replacement and success feedback after saving.

The committed browser suite exercises switching, export context, preview without writes, cancellation, downloading and restoring the original workspace, simulated storage failure without data loss, reload persistence, and immediate addition/removal of restored custom catalogs. Local runs also invoke the shared Google confirmation with synthetic data and verify that semester/tab are retained; they do not sign in or read/write a live Google backup. Desktop/mobile screenshots are available by setting `DIBIT_SCREENSHOT_DIR` to an existing directory.

## Fork review fixes (2026-09-07)

Reviewed the full fork delta from upstream `9216632abdc56ae8d224fa392d4c22703cd29b8f` to fork `bf2bb4ceccede2f175f075635b10087272a486ec`. The fixes following that review have 41 passing unit tests, a passing ESLint check, and a passing TypeScript/Vite build.

- Backup validation rejects unrelated JSON and malformed practice history, custom catalogs, theme values and workspace structures before either restore path replaces local data. Optional catalog lesson fields remain supported.
- Personal exam lists, search results and ICS exports share an exam identity that includes date, sitting, type and hour. Same-day intermediate and final exams survive export; true duplicates collapse.
- Calendar labels and highlighting use local calendar dates consistently with clicked date values, including western timezones.
- Export errors appear above the registration modal and remain interactive.
- `bun run test:browser` retains the browser regressions at 1280 × 800 in America/Los_Angeles and 390 × 844 in Asia/Jerusalem. It checks date labels/clicks, exported event counts, rejected restores without data loss, modal feedback, page errors, horizontal overflow and absence of identity values in localStorage. These are synthetic Chromium checks, not a live Google account round trip or a Google Calendar import.
- ESLint 9 now has a flat configuration. The inherited large main-bundle warning remains. DOC assets and byte-filling behavior are unchanged; no new native Word rendering verification is claimed.

## Historical verification (2026-09-05)

The notes below record earlier checks against https://arazim-project.com/dib-it/index.html and successive fork revisions. They describe the UI at that time; the README describes the current registration dialog, which leaves missing catalog details blank for completion in Word.

## Original UI and calendar

- Compared old and new desktop exam views at 1200 × 762 using the same two selected courses. The personal list, spacing indicator, calendar, sidebar, colours and tabs remain. Date search is behind one small button; faculty/course filters are collapsed.
- Checked personal exams, date search, return to personal exams and the registration dialog at 390 × 844, without horizontal page overflow.
- Calendar tests cover Jerusalem wall time, daylight-saving changes, minutes, semester boundaries, malformed data, all-day exams and duplicate/unselected groups. A previous repeat under America/Los_Angeles also passed. A real Google Calendar import has not been performed.

## Exact original DOC export

- The supplied original binary `.doc` is retained unchanged, with its SHA256 verified by a regression test. See `templates/README.md` for source identity and preparation.
- The browser fills a prepared copy of that original DOC by changing only allocated UTF-16 text bytes. It no longer generates a replacement DOCX. No local helper, Word installation, server conversion or cloud storage is required at export time.
- Downloaded a genuine `.doc` through the production UI at 390 × 844, with synthetic name and leading-zero ID plus two real selected courses. No JavaScript errors or page overflow occurred. Export issued only GET requests for the static JavaScript module and DOC template; student details were absent from localStorage.
- Downloaded a ZIP through the production UI with 15 selected synthetic groups. It contained two DOCs: the original 14-row form with groups 01–14 and a second original form with group 15. No data was dropped and no rows were added to the template.
- Opened the actual browser downloads in Microsoft Word 16.112.3, exported PDFs, and visually inspected every page: the two-course sample, the full 14-row form and the overflow form are each one page. Hebrew, mixed Hebrew/English, digit boxes, logos and the highlighted note render in the original layout. No repair prompt occurred.
- Compared Word inspection copies to the original: media bytes, page size/margins, table properties/grids, row properties and cell properties are identical. The supplied original remains untouched. DOCX/PDF inspection copies are QA artifacts, not the downloaded format.
- Unit tests check that output changes are confined to allocated text bytes, input buffers remain unchanged, corrupted templates are rejected, leading zeroes survive, unused slots are cleared, overflow splits correctly, and invalid controls/digit counts or oversized fields fail without producing misleading documents.
- Verified all six supplied examples with synthetic identity values: course numbers, groups, lesson types, framework, year/semester and each registering department's code/name. All six generated forms opened and rendered as one page in native Word; every page was visually inspected. The supplied “psychology” filename is treated as linguistics, as confirmed by the user. The two computer-science rows are retained as export-fidelity fixtures, but disagree with the 2025b catalog: course 03682158 is “מבני נתונים”, and group 17 is absent. Live exports use the catalog and selected valid groups.
- Verified the updated dialog at 390 × 844: empty name/ID, unknown department name, missing course name and missing lesson type block submission; completing them enables export. The math browser download is byte-identical to the Word-rendered math fixture. It made only static GET requests and did not save identity in localStorage. Its Word inspection copy retains identical media, page geometry, table grids/properties, row properties and cell properties to the original.
- The 2025b catalog scan covered 5,798 groups; the longest full title including lesson type and direction markers uses 119 UTF-16 units, below the prepared 160-unit course slot. Official titles are never truncated or automatically renamed. Longer custom text beyond the finite reservation is rejected as an exporter limitation.
- The original printed תשפ״ז heading remains. Year/semester boxes use the selected semester, and the dialog asks users to check the printed form year. Invisible zero-width padding remains in unused slot capacity. Long text can naturally wrap in the original cells; it is never silently truncated.

## Google account backup

- Verified the actual browser Google sign-in, backup and restore controls against isolated Auth/Firestore emulators using `demo-dibit` and a synthetic user. Saving a two-group schedule, clearing it locally, and restoring recovered both groups while retaining the selected semester/tab. Requests to live Google API hosts were blocked during this test.
- The configuration and backup payload handling are tested locally. All three Firestore emulator integration tests pass: private backup replacement/deletion, anonymous denial, and denial of access to other users, collection listing, subcollections and other paths.
- Emulator tests use only `demo-dibit` on localhost and refuse to run without the expected emulator address. Java 21 was unpacked under `/tmp` after checking Adoptium's published SHA256; no system installation was changed.
- Firebase project `dib-it-noam-isaac` is configured. Google sign-in is enabled for `dib-it.vercel.app`, `dib-it-noamisaacs-projects.vercel.app` and local `127.0.0.1`. The single Standard `(default)` Firestore database is in the user-selected Tel Aviv region (`me-west1`), reports `freeTier: true`, and has point-in-time recovery disabled. Firebase MCP reports billing disabled; no billing account, trial or paid service was enabled. The tested private rules are deployed, and a live unauthenticated document read returns 403.
- The Firebase-enabled build is deployed at https://dib-it.vercel.app. At 390 × 844 it returns HTTP 200, opens the correct Google login screen, and has no page errors or horizontal overflow. The four Firebase web configuration values are set in Vercel Production/Preview and ignored local configuration. A signed-in backup/restore round trip remains unverified; no user account was impersonated.

## Multiple saved plans

- Existing single-plan data migrates into the first named plan. Seven unit tests cover migration of all semesters/settings, blank plans, deep duplication, switching, rename/delete, stale callbacks, backup round trips, and rejection of malformed plan lists.
- Browser verification at 1280 × 800 and 390 × 844: created a blank plan without losing the original course, switched back, duplicated it, and selected a group in the duplicate while the original remained unchanged. The mobile page has no horizontal overflow or JavaScript errors.
- File and Google backup paths save the entire workspace; calendar and registration exports continue to consume the active plan. An additional Firestore emulator test verifies multiple plans and the active selection survive a round trip, and replacement removes deleted plans.

## Historical checks

- All 32 unit tests and the production TypeScript/Vite build pass. Four separate Firestore emulator integration tests pass.
- The build still reports the existing large main-bundle warning. The DOC export module and its 151 kB template load only when requested.
- At that revision, lint could not run because ESLint 9 lacked an `eslint.config.*`. The fork review fixes above restore the command.
