# UI and export verification

Checked on 2026-09-05 against https://arazim-project.com/dib-it/index.html.

- Compared the old and new desktop exam views at 1200 × 762 with the same two selected courses. The personal list, exam spacing indicator, calendar, sidebar, colours, and tabs are retained. The new search is behind one small button; faculty/course filters are collapsed.
- Checked the exam view, date search, return to personal exams, and registration dialog at 390 × 844. The registration preview shows course, number, and group without page overflow.
- Downloaded a real DOCX and ICS through the browser. Repeated the first Word download against the production build with no JavaScript errors. Verified synthetic student details were not written to localStorage.
- All 19 automated tests pass, including a repeat under America/Los_Angeles. Calendar cases cover Israel DST, lesson minutes, non-Sunday semester starts, inclusive semester end, malformed lesson data, all-day exams, and duplicate/unselected groups.
- DOCX tests cover selected groups, leading zeroes, academic year, XML escaping, Hebrew complex-script typography, RTL paragraphs/tables/section, repeating table headers, and empty schedules. All XML parts in the short, 36-row, and production-download samples parse; ZIP CRC checks pass.
- Microsoft Word opened and rendered the initial browser download. Visual inspection found a mixed Hebrew/number punctuation issue, subsequently corrected. The corrected files pass structural checks, but subsequent Word automation timed out before rendering the final short and multipage examples. Final punctuation and multipage pagination therefore still need visual confirmation in Word. The packaged renderer is unavailable here because pdf2image/LibreOffice are absent.
- TypeScript and the production build pass. The build reports the existing large-bundle warning; the Word generator is a separate lazy-loaded chunk.

## Integration limits

Google sign-in/backup configuration and payload handling are tested locally. Live Google sign-in, Firestore save/restore, and a real Google Calendar import were not performed. No Firebase project configuration was provided. Use the README setup instructions and .env.example to activate account backup; Calendar file export already works without an account.

The registration DOCX recreates the supplied form's fields in a clean editable layout. It does not reproduce the original logos or individual digit boxes. Confirm that this equivalent format is suitable for submission.

The repository's existing npm run lint command cannot run: ESLint 9 is installed but no eslint.config.* exists. This predates these changes.
