# Coordinated saves and reviewed schedule merging

This is a separate follow-up to PR #35, based on its corrected
`b8deeaf137cad187c09683471a93dfd0640702ab` head. It does not merge or deploy #35.
The exported schedule JSON remains compatible. No dependency was added.

**Draft, not release-ready.** Cross-browser verification disproved the proposed
Web Locks + localStorage guarantee. A tab can acquire the lock after another
tab's completed write and still read an older storage snapshot. This draft
preserves the implementation and failing evidence for review; it must not be
merged or deployed in its present form. See the replacement proposal below.

## Problem and boundaries

An independent unchanged-source Chromium reproduction lost an edit in 103/200
deliberately simultaneous trials. That is a stress result, not an ordinary-use
probability. Updating from the latest value at handler entry does not coordinate
two handlers that both read before either writes.

The local solution uses the native `dibit:workspace` Web Lock around reading,
deriving, validating and saving the complete update. Reads use one atomic storage
record. Network requests and user dialogs run outside the lock. The cloud boundary
uses Firestore transactions plus a monotonically increasing document revision;
security rules reject unversioned writes, stale revisions and document deletion.
The intended local guarantee is not established: the cross-browser failure above
invalidates it. The cloud revision protocol is a separate boundary. A Web Lock
alone does not coordinate computers.

## Writer inventory

| Writer | Protected operation |
| --- | --- |
| Course/group/color/order edits, practice history, degree settings, navigation | `updateDibIt` derives against the latest workspace inside `changeWorkspace` |
| Create/duplicate/rename/delete/switch plans | `updateWorkspace` derives inside the same lock |
| Catalog arrival and annual reconciliation | `reconcileCatalogs` runs after fetching, inside the same lock |
| Startup and historical migration | `initializeWorkspace` checks again after acquiring the lock |
| File restore and recovered older-tab copy | `replaceWorkspace` deliberately replaces the contents after confirmation |
| Recovery reset | `resetWorkspace` disables automatic sync and stores an empty replacement before legacy-key cleanup |
| Automatic Google upload/download | `startScheduleSync` exchanges a revision in a transaction; `acceptCloud` rechecks local state inside the local lock |
| Manual Google backup, restore and merge | The same controller/transaction/apply path, with the reviewed local version and cloud revision as preconditions |

The v2 local record contains workspace contents, a version, a replacement epoch,
source/time information, the last shared baseline and the observed legacy bytes.
One `setItem` replaces contents and bookkeeping together; a failed write retains
the previous record. Ordinary saves preserve the epoch. Explicit replacements
change it, preventing a delayed upload from acknowledging a reset/restore as an
ordinary descendant edit.

Callers that close dialogs, report completion or move focus await saving.
Ordinary controlled inputs reflect persisted state; rejected saves also produce a
shared visible error. A later successful save clears that error.

The asynchronous course-add caller reuses the reviewed course-readiness provider
and card refs from PR #37, with cancellation while waiting for storage. This is
needed because one animation frame can precede the new card's metadata render.
PR #37 itself is untouched; its later integration should retain one shared
provider and route the timetable action through its existing readiness API.

## Comparison and merge

The screen captures both copies, shows their source/time, plans and semester
counts, and provides expandable courses/groups/settings. Course names use the
catalog available on this device; IDs remain visible. Unknown historical times
stay unknown. Device timestamps are not evidence of completeness or causal order.

One pure comparison produces both the differences and the merge. Independent
changes relative to the last shared baseline combine automatically **within the
preview**. Nothing automatically merges in the background. Conflicting changes
require an explicit choice. The preview includes the result after reconciliation
against available catalogs, and saving checks that reconciliation still agrees.

- A course and academic year form one unit, including both semesters, selections,
  metadata and pending annual intent. Incompatible group choices are never unioned.
- Delete versus edit requires a choice; independent deletion does not resurrect
  data. Plan additions/deletions, plan metadata, course/plan order and shared
  settings are compared explicitly. Unknown fields remain part of the comparison.
- Without a valid shared baseline, show a two-copy comparison and whole-copy
  choices, not an inferred merge. Duplicate course identities and potentially
  coupled custom-catalog/selection changes also disable merging conservatively.
- Whole-copy choices remain replacements, with an explicit warning and downloads
  of both reviewed copies. File restore and reset remain deliberate replacements.

Every confirmation rechecks both reviewed versions. A changed copy requires a
fresh comparison; it is never silently substituted into an earlier approval.

## Partial completion and compatibility

Google and browser storage are not one distributed transaction. If Google saves
while local contents change, the newer local contents survive. A merge/download
that was not applied locally cannot become its acknowledged baseline. The UI
reports pending changes or explicitly says that Google saved but local saving
failed. Retrying compares the copies again. An ordinary upload may acknowledge its
uploaded ancestor while retaining subsequent ordinary local edits.

Older tabs cannot cooperate with Web Locks. V2 uses a new local key and retains
the old `Dib It` bytes. Later writes to that old key trigger a recover/download
notice and cannot replace v2 contents. Older cloud writers are rejected **only
after the revised server rules are deployed**. Very old tabs that write pre-
`Dib It` individual keys are outside that notice; those keys remain available for
manual recovery. Old tabs can still lose edits among themselves.

Browsers without native Web Locks retain the current view and JSON export, but
cannot save edits, navigation, restores, resets or Google changes. There is no
uncoordinated fallback. Migration and baseline retention use extra local storage;
quota failures preserve recoverable data and prevent a false success.

## Release requirements — not performed by this PR

1. Review the migration and export backups before any release.
2. Deploy the revised Firestore rules before enabling the v2 client. This rejects
   obsolete writes even during a staged client rollout. Older clients must reload
   to regain cloud saving; their local data remains available.
3. Publish the client only under a separately authorized release. Verify actual
   account sign-in and cloud round trips then. Do not roll back to permissive
   legacy rules while old and new clients coexist.

Automatic Vercel deployment is disabled specifically for
`codex/reviewed-schedule-merge` using the documented `git.deploymentEnabled`
configuration. Other branches retain their existing behavior.

## Runnable evidence and limitations

- `bun test`: merge decisions, annual intent, ordering, migration, corruption,
  delayed applies, partial cloud success and local failure recovery.
- `bun run test:browser`: actual controls and native browser locks, including
  `workspace-coordination.mjs` with 200 simultaneous two-tab trials, competing
  background writers, delayed cloud apply, lock-holder closure, quota recovery,
  old-tab isolation and explicit unsupported-browser refusal.
- `tests/browser/schedule-sync.mjs`: synthetic auth/cloud boundary, real UI,
  copy details, stale previews, explicit choices, delayed merge completion,
  offline/reconnect and sign-out. Optional screenshots use `DIBIT_SCREENSHOT_DIR`.
- `bun run test:firebase`: real Firestore clients against the localhost demo
  emulator, including competing clients, revision enforcement and old writers.
  Requires Java 21. It refuses to target a live project.
- `bun run test:deployments` serves two local builds; it does not deploy anything.

Passing Chromium runs demonstrate the tested cases, not a portable concurrency
guarantee. Closing a tab before its queued operation completes can cancel that
operation. Clearing browser storage, noncooperating scripts, previously erased
data, and historical recovery are not covered. A merge preserves chosen data; it
does not establish a conflict-free timetable or registration eligibility. These
checks do not constitute a live-account or production rollout test.

## Storage blocker and replacement proposal — approval required

The application test intermittently lost a restore/reset in Firefox. Tracing both
tabs showed a later edit derived from the record preceding the replacement.
An independent minimal page then verified the lock queue order before releasing
the holder. WebKit lost the preceding write in 5/100 trials, then 32/100 when
rerun through the committed probe (Chromium and Firefox lost 0/100 in both runs).
These are stress results;
the counterexample is enough to reject the proposed guarantee. The HTML standard
[does not specify cross-process localStorage coordination](https://html.spec.whatwg.org/dev/webstorage.html).

The native IndexedDB counterfactual preserved both edits in 200/200 trials in
each of Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6. An explicitly aborted
transaction left the old record intact and the next transaction succeeded.
That prototype covers the storage primitive, not the complete application.

Reproduce both experiments using the installed Playwright browsers:

```sh
bunx node@22 tests/browser/storage-boundary-probe.mjs locks
bunx node@22 tests/browser/storage-boundary-probe.mjs idb
```

Proposed change: keep the same workspace JSON and single contents/baseline record,
but store it in one native IndexedDB object store. Each writer reads, derives,
validates and writes in a single `readwrite` transaction. Report success only on
transaction completion. Keep network requests and dialogs outside it. IndexedDB
would replace Web Locks as the serialization boundary; no new dependency is needed.

Benefits: the database supplies the required [read/write transaction semantics](https://www.w3.org/TR/IndexedDB/#transaction-scheduling);
this avoids timing workarounds and a second authority for the same data. The
reviewed merge UI and Firestore revision checks can remain.

Implementation/regression risk: initialization, React's current snapshot and
cross-tab invalidation become asynchronous. Notifications must trigger a fresh
database read and never carry an authoritative stale snapshot. Migration must
check for an existing committed record inside the transaction and retain legacy
bytes. Reset must remain a replacement even if legacy cleanup fails. Local
quota/abort failures must never update the displayed committed snapshot or sync
baseline. This is a change to the approved persistence mechanism, not just a
browser-specific patch.

Compatibility: exports retain their existing JSON shape. Older clients still
write their separate legacy storage and require the existing recovery path.
IndexedDB unavailable/blocked means explicit current-view/export-only behavior,
with no localStorage write fallback. Exported backups remain the rollback route;
do not silently migrate writes back to the old store.

Acceptance plan: rerun real concurrent checkbox handlers, every background writer,
both restore/reset orderings, startup migration races, delayed cloud application,
account changes, abort/quota recovery, tab closure and cross-tab notifications in
all three engines. Retain the Firestore emulator tests for competing computers,
the reviewed-copy/stale-choice UI tests, and existing application regressions.
Only after those pass may this draft be reconsidered for release review.
