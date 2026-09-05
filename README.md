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

- Clone the repository and install the dependencies with `bun install` (or `npm install` or `yarn install`).
- By default, schedules are saved locally in the browser. File backup, restore, and calendar export are available without signing in.
- Run a local development server with `bun run dev` (or `npm run dev` or `yarn dev`)

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

## Registration forms

Under the sidebar's **פעולות** menu, choose **יצירת טופס רישום ב-Word**. Preview the selected groups, optionally enter a student name and ID, and download an editable `.docx`. The generated form contains the fields from the Lautman interdisciplinary program's supplied registration form; it is a clean equivalent, not an exact reproduction of the original logos and letter boxes. It uses the selected academic year and semester, preserves leading zeroes, and includes one row per valid selected group. Additional fields allow changing the department, registering department, degree, framework and semester code. Student details exist only in the dialog and downloaded file; they are not saved locally or backed up to Google. Review the form before submission.

The Word-generation library loads only when the download is requested.

## Google compatibility

Calendar export works without sign-in. It downloads an ICS file for manual import into Google Calendar on a computer or Apple Calendar. Lessons use Jerusalem wall time, including minutes and daylight-saving transitions, and exams are all-day entries. Each weekly lesson is exported as individual dated events through the end of the semester; holidays and cancellations are not inferred. This is a snapshot, not automatic calendar synchronization. See [Google's import instructions](https://support.google.com/calendar/answer/37118).

For Google sign-in and schedule backup, copy `.env.example` to `.env.local` and supply the four Firebase web app values. Complete configuration enables sync automatically; `VITE_ENABLE_GOOGLE_SYNC=false` explicitly disables it. The original ignored `src/firebase.json` format is also supported, with environment values taking precedence. Without complete configuration, the site continues in local mode. Enable the Google provider in Firebase Authentication and authorize the deployment domain (and localhost for development). See [Firebase's Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin).

The Firebase project must allow authenticated users to read and write only their own `users/{uid}` document. Backups replace that document so deleted courses do not reappear; restore checks the payload and keeps the current semester and tab. Using a different Firebase project does not migrate backups from the old site's project; use file backup/restore to transfer them.

## Validation and Vercel

Run `bun test` and `bun run build`. Deploy with `npm run deploy` after linking the checkout to your Vercel project. The Vercel configuration uses the committed Bun lockfile.

See the Google compatibility section above for optional Firebase configuration.
