# Reviewed schedule conflicts

This follow-up to PR #35 improves recovery when a device and Google contain
different schedule copies. It keeps the existing `Dib It` localStorage key and
workspace/plan structure. The combined candidate adds a `schemaVersion: 1` marker
and preserves retired fields at their original locations; see the
[migration and integration review](combined-schedule-candidate.md). Ordinary edits, plan management, catalog reconciliation,
initialization, file restores and resets retain their synchronous behavior.
No dependency was added. Nothing is merged or deployed by this work.

## User flow

When automatic sync detects divergent copies, it stops, saves the automatic-sync
setting as off on this browser, and opens the comparison. Other computers are not
remotely switched off. Canceling or manually resolving the comparison leaves this
browser's automatic sync off. Closing the popup leaves a reminder until reload;
the off setting persists across reloads.

Turning automatic sync on opens a fresh comparison first. It stays off until a
reviewed result has been saved successfully and the user explicitly confirms
enabling it. A stale copy, offline failure or newer local edit prevents enabling.
The whole-copy warning explains that the displayed differing course choices may
be replaced. Transient connection failures retain the existing retry behavior.

The comparison shows:

- The local and Google copies, known source/time, plan and semester counts.
- Course names and IDs, group choices, deletions and incompatible changes first.
- Expandable full contents, settings, remaining differences and merged result.
- Downloads of both reviewed copies before a choice replaces anything.
- A separate download of the original legacy Google workspace, when retained by
  the migration. This is distinct from the current Google copy and has no known
  original save time. Retired fields are grouped as inactive recovery data.

Times are evidence about the copy, not proof that it is more complete. Google
times come from its server timestamp; old cloud backups have unknown times.
`Dib It Updated` is optional display metadata containing a content fingerprint,
time and source. It is trusted only when its fingerprint matches the current
workspace. Navigation preserves it; an older writer's different content makes
the time unknown. Its failure never prevents a schedule save. Device times depend
on that device's clock. Course names use catalog information available locally.

## Conservative merging

One pure comparison supplies both the displayed deltas and merged result.
Independent changes relative to the last shared baseline combine in the preview.
Incompatible changes need an explicit choice. There is no background auto-merge.

A course and academic year are one unit, including both semesters, selections,
metadata and pending annual intent. Competing group choices are never unioned.
Delete versus edit requires a choice; independent deletion does not resurrect
data. Plans, their metadata/order, course order, shared settings and unknown fields
participate in the comparison. The displayed result includes reconciliation with
available catalogs; saving checks that reconciliation still agrees.

Without a valid common baseline, merging is disabled and whole-copy choices remain.
Duplicate course identities and potentially coupled custom-catalog changes also
disable merging. A merge does not establish timetable validity or eligibility.

## Cloud and local boundaries

Manual backup, download, merge and automatic sync share one controller. A reviewed
choice checks the captured local contents/receipt and cloud revision. Firestore
transactions retry against the latest cloud document and reject stale decisions.
Server rules require a supported workspace inside a versioned envelope and an
increasing revision, reject obsolete unversioned writes, and preserve account
ownership checks. A legacy cloud replacement atomically retains the original
workspace map, which later writes cannot change or remove.

After a network response, local contents are checked again before applying the
download/merge. A newer observed local edit survives; the unaccepted copy cannot
become its shared baseline. The sync receipt is written after the workspace.
A receipt failure may leave a successfully downloaded copy with the old baseline;
the UI reports incomplete sync and requires another comparison. It never claims
that the earlier local contents necessarily remain. Google and browser storage
are not a single transaction. Requests already committed by Google cannot be
undone by switching off sync afterward.

## Accepted limitation: simultaneous local tabs

Local checks are best-effort snapshots, not a transaction. Two tabs, an older open
tab, or a background writer can still overwrite a concurrent local change. A
popup only helps when both differing copies remain observable; it cannot recover
an edit already absent from all copies. Browser storage clearing and historical
recovery are also outside this feature. Downloaded backups remain useful.

The user explicitly chose to defer the local persistence rewrite. This change
contains no Web Locks, IndexedDB migration, isolated workspace namespace or new
unsupported-browser editing restrictions. No portable local concurrency guarantee
is claimed. The earlier stress experiments and rejected lock approach remain in
[the investigation snapshot](https://github.com/noam-isaac/dib-it/blob/333deab52c5b3ada105cce912483d18136c6326a/docs/workspace-coordination.md).
Those forced-simultaneity results are not ordinary-use probabilities.

## Validation and release

- `bun test`: pure merge decisions and controller behavior, timestamps, stale local
  reviews, delayed cloud application, and storage/receipt failure recovery.
- `bunx node@22 tests/browser/schedule-sync.mjs`: actual UI with synthetic cloud
  data, popup/pause, cancel/resume, stale choices, delayed application, copy details,
  offline recovery and sign-out. `DIBIT_BROWSER=firefox` or `webkit` selects another
  installed engine; the test deliberately runs without Web Locks.
- `bun run test:firebase`: demo-project Firestore emulator checks for competing
  clients, revision enforcement, obsolete writers and account isolation.
- `bun run test:browser`: existing application regressions, including #35 controls.
  `bun run test:deployments` checks exports across two local builds; it does not
  deploy anything.

Before a separately authorized release, deploy the revised Firestore rules before
the revised client. Older clients then lose cloud-write access until refreshed;
their local copies remain available. Old local tabs are not isolated by this
feature. Verify live sign-in and cloud round trips at release; local tests do not
constitute a live-account check. Automatic Vercel deployment remains disabled for
`codex/reviewed-schedule-merge`. PR #35 and other PRs remain unchanged.
The same guard is present for `codex/combined-schedule-migration`.
