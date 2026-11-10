# Reviewed schedule conflicts

This follow-up to PR #35 improves recovery when a device and Google contain
different schedule copies. It keeps the existing `Dib It` localStorage key and
workspace/plan structure. The combined candidate adds a `schemaVersion: 1` marker
and preserves retired fields at their original locations; see the
[migration and integration review](combined-schedule-candidate.md). Ordinary edits, plan management, catalog reconciliation,
initialization, file restores and resets retain their synchronous behavior.
No dependency was added. This work was incorporated into
[PR #39](https://github.com/noam-isaac/dib-it/pull/39), merged and deployed on
2026-10-31. [PR #40](https://github.com/noam-isaac/dib-it/pull/40) then released the
missing-backup correction described below. PRs #35–38 are closed as incorporated
through #39. See [verification](verification.md) for release evidence and limits.

The rapid-edit, review-freshness and group-comparison corrections and the simpler
sync flow described below are an unreleased follow-up to those releases.

## User flow

One saved preference enables Google sync. A small status next to the account
shows off, waiting, or up to date; errors and genuine choices are actionable there.
Ordinary edits save locally and show waiting immediately, including during the
short pause before uploading. An older device with no unsynced edits updates automatically; offline
edits retry when connected. Matching copies, changes on one side, and independent
changes on both sides need no decision. There are no manual Google upload/download
controls, routine success notifications, or merge-mode selectors.

Only competing choices produce a small notice. It never opens a popup, disables
editing, or turns sync off. Opening it shows the actual competing values, with one
save action. Independent changes are included automatically without a preview or
approval. Updates to unrelated data preserve the user's answers; changed alternatives
need a new answer. Decisions that stop competing disappear from the prompt.

Membership decisions can reveal an ordering decision. The prompt and controller
recompute the same comparison with the selected answers, retaining only answers
whose alternatives still match.

Submitting closes the prompt and lets the existing sync controller finish. A
connection failure retains the approved answers and retries against fresh contents.
No background-save notification or separate review listener is needed. The controller
revalidates every answer before writing; it cannot replay a stale merged snapshot.
A new unanswered conflict leaves both versions intact and shows the small notice
again. An open prompt closes once the controller confirms completed synchronization.
Turning sync off stops incoming application; completed uploads still retain their
acknowledgements so restarting cannot overwrite an intervening edit.

If both sides already contain different schedules without usable shared history,
or their custom catalog changes cannot safely combine, the prompt instead asks
which schedules to continue with. It shows both sets and explicitly says that the
selection replaces the other schedules and settings. There is no preselected answer.
The final action explicitly says to use these schedules on all devices. Any content
change invalidates that whole-copy consent. Ordinary conflict resolution
does not offer whole-copy replacement.

A missing Google copy is created after a successful server read. Failed reads never
count as absence, and a transaction rechecks any copy another device creates while
saving. A blank new device loads the shared schedules automatically.

Google holds the current shared schedules, including deletions. File backup and
restore remain separate actions for independent snapshots. File restore explains
that all plans and shared settings will be replaced, with a prominent warning
that active sync carries the restore to Google and other devices, including deletions. It checks local content again before replacement; navigation does
not invalidate that confirmation. File backups are never a prerequisite to sync.

## Conservative merging

One pure comparison supplies both the displayed deltas and merged result.
Independent changes relative to the last shared baseline combine automatically.
Incompatible changes need an explicit choice. The controller recomputes the merge
against the current local and cloud copies on every transaction attempt, rather
than reusing a stale proposal.

A course and academic year are one unit, including both semesters, selections,
metadata and pending annual intent. Competing group choices are never unioned.
Selected groups and the group lists inside pending edits compare as sets, so click
order alone cannot create a difference. Comparison does not mutate stored copies.
Plan order, course order and the sequence of pending edits remain significant.
Delete versus edit requires a choice; independent deletion does not resurrect
data. Plan names merge separately from academic settings; school, program and degree
start year stay together. Practice markers merge by individual membership, retaining
both additions and removals. Unknown metadata remains grouped conservatively. Plans,
their order, course order and shared settings participate in the comparison.
Catalog reconciliation must leave the selected content unchanged before saving.

Without a valid common baseline, merging is disabled and whole-copy choices remain.
Duplicate course identities also disable merging. A custom-catalog change needs
a whole-copy choice only when it changes a course's effective definition while the
other copy changes that course's selections or pending annual intent. Edits to
other courses, styling, navigation, and shadowed definitions do not trigger this
dependency check. The last custom source for a course controls its details and
annual classification. Sync receipts retain source precedence explicitly; new
protocol-3 cloud envelopes carry a separate `catalogSources` list because Firestore
sorts map keys. Reads validate that the list names every source exactly once and
restore that order before comparing or applying data. Older receipts are still
usable unless their sorted maps contain competing definitions whose original
precedence cannot be recovered. Equal current copies never need a choice.
Source reordering alone is ignored when it leaves every effective definition
unchanged, including overlapping sources with identical definitions. Source contents
still matter, so shadowed edits and deletions are preserved. Harmless reordering
does not invalidate an answer or compete with an independent import. Competing catalog
edits need a catalog choice; a changed definition coupled with another device's
selection of that course needs a whole-copy choice.
The initial equality check uses the same catalog comparison, even without shared
history. Equivalent copies acknowledge directly, retaining their original source
order and local contents without an upload, replacement, or choice.
A merge does not establish timetable validity or eligibility.

## Cloud and local boundaries

Automatic sync and submitted choices use one controller per signed-in browser session. A whole-copy choice checks the captured local and cloud contents,
including archived fields and catalog source precedence. Individual choices are retained
only while both alternatives remain unchanged; all other edits are recomputed against
the latest shared baseline. Timestamps and redundant
cloud revisions do not invalidate an unchanged review. Firestore transactions
retry against the latest cloud document and reject changed contents.
Server rules accept protocol 2 and 3 with increasing revisions, reject downgrades
from protocol 3, and preserve account ownership checks. New clients read both
formats and write protocol 3. Deploy the updated rules before the client; old
clients must update after an account upgrades to protocol 3 and cannot replace its
ordered catalog data. A legacy cloud replacement atomically retains the original
workspace map, which later writes cannot change or remove.

Local review versions exclude the selected tab, semester and active plan, which
remain local when accepting a cloud copy. If preserving navigation would reconcile an
approved merge into different course selections, that merge is not applied locally.

Each transaction attempt reads the latest local contents and baseline. If they
change after the decision but before an automatic conflict is reported, sync
retries against fresh copies instead of opening a stale comparison.

Before sending a write, the browser retains the exact local input and fingerprints
of the receipt and proposed contents. Unconfirmed retries at the same server revision
remain recognizable until one outcome is known.
If this local write fails, nothing is sent. A lost response, SDK transaction retry,
or reload can recognize the committed result and recover its local ancestor before
comparing again, preserving a newer undo. An unchanged server revision is not proof
that a delayed write cannot arrive: a confirming transaction advances that revision
without changing its contents when no new upload is needed. A single revision with
different contents proves another device won, so normal merging can continue.
Multiple unrecognized later writes make the old history unavailable, preserving
both copies for a real choice. A durable acknowledgement clears the pending attempts; they are recovery
metadata, not another user-facing backup or workflow.

After a network response, local contents are checked again before applying the
download/merge. A newer observed local edit survives; the unaccepted copy cannot
become its shared baseline. For a background merge, the exact local input is also
a safe base for rechecking edits made during the network wait. If those newer edits
and the committed merge can coexist, both are applied locally, the committed cloud
content becomes the baseline, and the remaining local edits upload next. A real
collision, changed receipt, or changed catalog preparation leaves local data intact.
Explicitly reviewed replacements still require unchanged local content.
Before an incoming replacement, a small history-unavailable marker must be saved
in the existing sync receipt. Failure to save it stops the local replacement.
The completed receipt is written after the workspace. If the workspace write
fails without changing its stored bytes, the previous receipt is restored when
possible, so a transient failure can retry normally.
A failed local application after a committed merge records the exact local input
as the deferred ancestor before retrying. This includes exceptions from workspace
storage, not just a newer-edit rejection, so an undo cannot be mistaken for an
unchanged device and replaced by the committed merge.
A completed upload can record its shared baseline while newer local edits wait,
provided no other sync has advanced the receipt. Completing a timestamp is harmless;
an already acknowledged equivalent copy succeeds without rolling its receipt back.
This leaves newer edits intact
and lets the next automatic upload proceed without conflicting with its own
previous upload. If another device also changes that baseline, the divergent
local and remote edits are compared again and merge only when independent.
A failed receipt write retains the exact acknowledgement in memory and retries it
before subsequent sync work, including after switching sync off/on.
Acceptance also settles that pending receipt before a deferred fallback. A merge
already applied locally therefore keeps its applied baseline if both the receipt
and safety-marker writes failed; a later undo remains a new local change.
That retry never reapplies the workspace or replaces a newer receipt from another
operation/account. The marker saved before application survives even if every
later acknowledgement write fails. After a reload, matching copies acknowledge
automatically; differing copies remain intact for a choice because completion is
uncertain. Recovery cannot treat an applied-then-undone merge as an unapplied
upload. Local-save failures report incomplete
sync; they never claim that earlier local contents necessarily remain. Google and browser storage
are not a single transaction. Requests already committed by Google cannot be
undone by switching off sync afterward.
Completed uploads still record their receipt when sync is turned off; they never
apply remote contents while off. A committed but unapplied merge records its exact
local input as the ancestor for the next comparison, preserving later local edits
and remote contributions. Controllers in the same tab finish in order, so restarting
sync cannot race ahead of a still-pending acknowledgement.

## Accepted limitation: simultaneous local tabs

Local checks are best-effort snapshots, not a transaction. Two tabs, an older open
tab, or a background writer can still overwrite a concurrent local change. A
comparison only helps when both differing copies remain observable; it cannot recover
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
- `node tests/browser/schedule-sync.mjs`: actual UI with synthetic cloud data,
  automatic device handoff and independent merges, specific competing choices,
  retained answers and retry, lost commit responses, reloads, stale responses,
  storage failure recovery, first-time decisions, file recovery, and sign-out.
  Layout checks cover 320, 390, 768 and 1280 pixel widths.
  `DIBIT_BROWSER=firefox` or `webkit` selects another installed engine.
  The test deliberately runs without Web Locks.
- `bun run test:firebase`: demo-project Firestore emulator checks for competing
  clients, revision enforcement, obsolete writers, account isolation and pending
  upload recovery through the production storage boundary.
- `bun run test:browser`: existing application regressions, including #35 controls.
  `bun run test:deployments` checks exports across two local builds; it does not
  deploy anything.

The revised Firestore rules were deployed before the #39 client. Older clients
lose cloud-write access until refreshed; their local copies remain available.
Old local tabs are not isolated by this feature. Real Chrome checks subsequently
verified sign-in, automatic upload, explicit restore and persistence. #40's
missing-backup path has automated regression coverage; the live post-release check
used an existing matching backup. See [verification](verification.md) for details.
Automatic Vercel deployment remains disabled for the original
`codex/reviewed-schedule-merge`, `codex/combined-schedule-migration` and
`codex/no-backup-sync-conflict` branches.
