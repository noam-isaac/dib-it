<h1 align="center">
    <a href="https://arazim-project.com/dib-it/">🗓️ Dib It</a>
    <br />
    <img src="https://img.shields.io/badge/updated-2026-purple.svg">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg">
</h1>

<p align="center">
    <b>A schedule planning website for Tel Aviv University built with <a href="https://react.dev">React</a>, <a href="https://mantine.dev">Mantine</a> and <a href="https://firebase.google.com">Firebase</a></b>
</p>

<p align="center">
    📖 <a href="#usage">Usage</a>
    &nbsp;&middot&nbsp;
    💻 <a href="#developing">Developing</a>
    &nbsp;&middot&nbsp;
    🚗 <a href="#roadmap">Roadmap</a>
</p>

# Usage

The website should be pretty straight-forward.
To export your schedule to Google Calendar, click: "<span dir="rtl">ייצוא ל-Apple/Google Calendar</span>".
You will download an ICS file, which you can import to [Google calendar](https://support.google.com/calendar/answer/37118?hl=en&co=GENIE.Platform%3DDesktop), [Apple calendar](https://support.apple.com/en-il/guide/calendar/icl1023/mac) (or most other calendars as well).

# Developing

To start developing Dib It, you need to follow these steps:

- Clone the repository and install the dependencies with `bun install`. This project uses the committed Bun lockfile.
- By default, schedules are saved locally in the browser. File backup, restore, and calendar export are available without signing in.
- Run a local development server with `bun run dev`.

You are **highly encouraged** to send pull requests or feature requests!

# Roadmap

- [x] Schedule view
- [x] Google sync
- [x] Export to Google/Apple calendar
- [x] Show exam list/calendar
- [x] Show difference between exam dates
- [x] Suggest courses based on exam date

## Exams

The personal exam list, practice list, exam-spacing suggestions, and calendar export include only courses with a selected group that exists in the current semester. Adding a course to the sidebar alone does not schedule it.

The **מבחנים** tab keeps the original personal exam list, spacing indicator, and calendar. Click **חיפוש קורסים לפי תאריך בחינה**, or a day in the calendar, to discover exams across the selected semester. Choose a single date or an inclusive range using the date fields. Course and faculty filters are under **סינון לפי קורס או פקולטה**. Add a matching course to the sidebar to choose its groups. All exam sittings are included; entries without a valid date are skipped.

## Saved plans

Use **תוכנית שמורה** above the semester selector to switch between named alternative schedules. **חדשה** starts an empty plan; the adjacent menu duplicates, renames, or deletes a plan. Deletion requires confirmation, and the final plan cannot be deleted. Each plan keeps independent course/group selections, colors, and degree settings across all semesters. Theme, custom course catalogs, and exam practice history are shared.

Existing schedules and older backups become the first plan automatically. Local JSON and Google backups include every plan and the active selection. Calendar and registration exports use only the active plan and selected semester. Restore replaces all local plans; use a backup first if you want to keep them.

## Registration forms

Under the sidebar's **פעולות** menu, choose **יצירת טופס רישום ב-Word**. Enter your name and nine-digit ID, confirm the registering departments, and complete any missing lesson types and download a genuine `.doc` directly from the browser. It fills a prepared copy of the supplied original registration form, retaining its logos, typography, digit boxes, tables, page setup and printed תשפ״ז heading. It does not reconstruct a DOCX or use a local helper, server-side document conversion, or Microsoft Word at export time.

A separate form is filled for each registering department, including its code and name. Department codes are suggested from course-number prefixes; unknown names must be supplied. Names in the six supplied examples are prefilled and editable. Each course includes its selected group’s lesson type. The original form has 14 course rows; additional rows continue in another original form. Multiple forms download together as a ZIP. Leading zeroes are preserved. Unselected or stale groups are excluded. The year/semester digit boxes use the selected semester; the original printed heading is retained, so check that the supplied תשפ״ז form is appropriate for your registration. Student details remain in the dialog and downloaded files only; they are not stored in localStorage or Google backup.

The browser verifies the prepared template's SHA256 and changes only its allocated UTF-16 text bytes. It leaves every other byte unchanged and rejects values that exceed the allocated slots or would corrupt the document. Unused slot capacity contains invisible zero-width spaces, so Word's character counts include that padding. Long course names may wrap as they do when typed into the original form; review the downloaded document before submission.

The export module and template load only when requested. See [template provenance and maintenance](templates/README.md) for the untouched source, preparation process, and fidelity checks.

## Google compatibility

Calendar export works without sign-in. It downloads an ICS file for manual import into Google Calendar on a computer or Apple Calendar. Lessons use Jerusalem wall time, including minutes and daylight-saving transitions, and exams are all-day entries. Each weekly lesson is exported as individual dated events through the end of the semester; holidays and cancellations are not inferred. This is a snapshot, not automatic calendar synchronization. See [Google's import instructions](https://support.google.com/calendar/answer/37118).

For Google sign-in and schedule backup, copy `.env.example` to `.env.local` and supply the four Firebase web app values. Complete configuration enables sync automatically; `VITE_ENABLE_GOOGLE_SYNC=false` explicitly disables it. The original ignored `src/firebase.json` format is also supported, with environment values taking precedence. Without complete configuration, the site continues in local mode. Enable the Google provider in Firebase Authentication and authorize the deployment domain (and localhost for development). See [Firebase's Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin).

The Firebase project must allow authenticated users to read and write only their own `users/{uid}` document. Backups replace that document so deleted courses do not reappear; restore checks the payload and keeps the current semester and tab. Using a different Firebase project does not migrate backups from the old site's project; use file backup/restore to transfer them.

`firestore.rules` permits access only to the signed-in user's own backup. Collection listing, other users' backups, and subcollections are denied. Run `bun run test:firebase` with pnpm and Java 21 or newer to verify this against a local emulator. The suite uses the `demo-dibit` project and refuses to run without the expected localhost emulator address.

For this fork, Google backup uses an unbilled **Spark** project with one free-tier Standard database in Tel Aviv (`me-west1`), as specified in `firebase.json`. Local Google sign-in uses `http://127.0.0.1:5175`. Do not link a billing account, activate trial credits, upgrade to Blaze, or add paid services. On Spark, quota exhaustion can interrupt backup; do not resolve it by enabling billing. Local storage, file backup, and calendar export remain available. See [Firebase's pricing-plan documentation](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans). The local emulator tests neither create nor configure a cloud project.

## Validation and Vercel

Run `bun test` and `bun run build`. Deploy with `bun run deploy` after linking the checkout to your Vercel project. The Vercel configuration uses the committed Bun lockfile.

See the Google compatibility section above for optional Firebase configuration.
