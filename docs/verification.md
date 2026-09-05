# UI and export verification

Checked on 2026-09-05 against https://arazim-project.com/dib-it/index.html.

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
- The original printed תשפ״ז heading remains. Year/semester boxes use the selected semester, and the dialog asks users to check the printed form year. Invisible zero-width padding remains in unused slot capacity. Long text can naturally wrap in the original cells; it is never silently truncated.

## Google account backup

- The configuration and backup payload handling are tested locally. All three Firestore emulator integration tests pass: private backup replacement/deletion, anonymous denial, and denial of access to other users, collection listing, subcollections and other paths.
- Emulator tests use only `demo-dibit` on localhost and refuse to run without the expected emulator address. Java 21 was unpacked under `/tmp` after checking Adoptium's published SHA256; no system installation was changed.
- Firebase project `dib-it-noam-isaac` is configured. Google sign-in is enabled for `dib-it.vercel.app`, `dib-it-noamisaacs-projects.vercel.app` and local `127.0.0.1`. The single Standard `(default)` Firestore database is in the user-selected Tel Aviv region (`me-west1`), reports `freeTier: true`, and has point-in-time recovery disabled. Firebase MCP reports billing disabled; no billing account, trial or paid service was enabled. The tested private rules are deployed, and a live unauthenticated document read returns 403.
- The Firebase-enabled build is deployed at https://dib-it.vercel.app (deployment `dpl_6LEZMVPe1Yqrumd31VLBMRmG6XAj`). At 390 × 844 it returns HTTP 200, opens the correct Google login screen, and has no page errors or horizontal overflow. The four Firebase web configuration values are set in Vercel Production/Preview and ignored local configuration. A signed-in backup/restore round trip remains unverified; no user account was impersonated.

## Checks

- All 25 unit tests and the production TypeScript/Vite build pass. Three separate Firestore emulator integration tests pass.
- The build still reports the existing large main-bundle warning. The DOC export module and its 151 kB template load only when requested.
- The existing lint command cannot run because ESLint 9 is installed without an `eslint.config.*`. This predates these changes.
