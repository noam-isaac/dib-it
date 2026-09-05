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
- The original printed תשפ״ז heading remains. Year/semester boxes use the selected semester, and the dialog asks users to check the printed form year. Invisible zero-width padding remains in unused slot capacity. Long text can naturally wrap in the original cells; it is never silently truncated.

## Google account backup

- The configuration and backup payload handling are tested locally. All three Firestore emulator integration tests pass: private backup replacement/deletion, anonymous denial, and denial of access to other users, collection listing, subcollections and other paths.
- Emulator tests use only `demo-dibit` on localhost and refuse to run without the expected emulator address. Java 21 was unpacked under `/tmp` after checking Adoptium's published SHA256; no system installation was changed.
- The account initially listed no Firebase projects. No cloud project, billing account, paid service, trial or live deployment was created or changed. Live sign-in and backup remain unconfigured and unverified. Deployment requires a separately approved unbilled Spark project; do not enable billing to resolve quota failures.

## Checks

- All 21 unit tests and the production TypeScript/Vite build pass. Three separate Firestore emulator integration tests pass.
- The build still reports the existing large main-bundle warning. Removing DOCX reconstruction reduced the lazy export module from approximately 452 kB to 146 kB, plus the 152 kB retained DOC asset.
- The existing lint command cannot run because ESLint 9 is installed without an `eslint.config.*`. This predates these changes.
