# Combined schedule candidate

This change brought PRs #32–38 together with the versioned workspace migration.
[PR #39](https://github.com/noam-isaac/dib-it/pull/39) merged as `be62bc8` and was
released on 2026-10-31, with the compatible Firestore rules published first.
PRs #35–38 are closed as incorporated through #39; their original branches remain
unchanged. [PR #40](https://github.com/noam-isaac/dib-it/pull/40) subsequently fixed
the missing-backup conflict and was released as `3698591`.
See [release and live verification](verification.md) for the completed checks and
remaining limits. Automatic Vercel deployment remains disabled for the original
`codex/combined-schedule-migration` branch.

## Inputs

| PR | Scope | Reviewed input commit |
| --- | --- | --- |
| #32 | Bounded shared data requests | `4b256b5bc498a7baf8692d7e4b9d429e1dc119a1` |
| #33 | Immutable UI edits | `f44204e7f80a1223b0e79f24c49c411cfec72dd9` |
| #34 | Legacy storage recovery | `ef8c57d7fe950d78e2870ab90e5e281f11ad762a` |
| #35 | Edits bound to the displayed plan/semester | `b8deeaf137cad187c09683471a93dfd0640702ab` |
| #36 | Exports owned by the current view | `7af17c84148204685b0e25996f495f5dd6a56ec8` |
| #37 | Course focus readiness and cancellation | `83acb22c2e2d0f5db09f2e5f2a6ce857cbf04aa0` |
| #38 | Reviewed merge, copy details and paused conflicting sync | `b5e16e711af94cce05f884f717a7d34a7bf1d259` |

The original Tests export fix is already in `main` through #31. The previous
combined candidate was `f21750e`; it did not contain #38 or this migration.

## Design council decisions

Three independent agents inspected data ownership, synchronization and recovery
before implementation. Their findings changed the design in these ways:

- Fix both read and write projections. Spreading an entire plan over workspace
  settings lets obsolete values override navigation and leak back into shared data.
- Convert all inputs with one pure, version-aware decoder. Preserve unknown
  metadata at its existing location; never promote it to an editable setting.
- Workspace navigation is authoritative. Legacy inputs may use a valid active-plan
  navigation value only when the workspace value is absent. The version marker
  prevents that fallback from returning after later edits.
- Materialize historical root course/program fallbacks into each plan that used
  them. Preserve the old root values as inactive metadata. Root annual intent was
  never consumed as plan intent, so it must not suddenly become active.
- Shared substantive values must agree across the effective legacy views. Conflicts
  produce a recoverable error rather than silently discarding data or expanding a
  custom catalog's effect to another plan.
  Custom-catalog source order must also agree: the last source defining a course
  controls its details and annual classification. Different source orders are
  conservatively rejected, even when the sources do not overlap.
- Preserve usable old merge baselines. Their missing active-plan identity is safe
  only because all substantive conversions are independent of that identity.
  Unusable history is distinct from first connection and cannot authorize overwrite.
- Semantic equality ignores known retired fields; stale-review checks still compare
  full copies. A merge keeps the local copy's retired fields for existing plans and
  a remote-only plan's own retired fields. Unknown metadata remains part of review.
- Save the new local recovery package in a bounded journal before a schema-changing
  write. The journal holds the previous successful package plus one pending attempt.
  The primary workspace write commits the attempt; an exact matching pending target
  remains readable after interruption. Every later writer settles the journal first.
  Failed attempts cannot discard the previous successful original. Exact-byte no-op
  imports do not rotate recovery. Ordinary edits preserve the successful package.
- Use the exact primary workspace bytes to identify the committed pending target.
  No separate migration-complete flag and no automatic rollback from the recovery
  package.
- Future local/file/cloud versions cannot be silently replaced by this client.
  Local raw recovery download and an explicit local workspace reset remain
  available; an unsupported Google copy stays untouched and requires a compatible
  client before comparison or replacement.

## Independent implementation review

Fresh reviewers found gaps not covered by the first passing tests:

| Finding | Required correction |
| --- | --- |
| A failed second migration replaced the prior recovery package | Atomic committed/pending journal, including interruption and promotion-failure checks |
| Initial default navigation and empty-course normalization wrote old data | Derive initial navigation in memory; keep unchanged course representation; persist only actual edits/reconciliation |
| A delayed duplicate form copied the newly active plan | Bind the operation to the plan that opened the form; report a removed source |
| Cloud upload/merge replaced a legacy original before local recovery | Preserve the original map in the same Firestore transaction as the replacement |
| Confirmed local reset was immediately undone by automatic cloud download | Disable automatic sync before deleting local data, keep the primary workspace until last, leave Google untouched |
| Recovery controls failed silently when browser storage was denied | Visible Hebrew errors, truthful partial-reset feedback and retry checks |
| An unfamiliar cloud envelope with extra fields was misclassified as a legacy workspace | Recognize the reserved envelope fields before strict protocol/shape validation, in both client and server rules |
| Opposite custom-catalog source orders were considered equal during migration | Preserve source precedence when comparing shared values; refuse ambiguity and retain downloadable originals |

Two independent reviewers compared cloud preflight/local staging with an atomic
Firestore archive. The latter avoids coordinating a remote commit with local
recovery bookkeeping. `migrationOriginal` stores the exact prior workspace map;
server rules require the exact preimage on conversion and preserve it unchanged
on later writes. The comparison offers a separate original download. It does not
enter live workspace data, merge choices or ordinary backups.

This cloud original is retained through later cloud replacements and local resets.
It is one bounded original, not a history log. Its full size/depth count toward
Firestore limits; preserving it can make a large legacy document too large to
upgrade. In that case the upload fails and the existing cloud copy remains intact.
No archive is silently dropped to make an upload fit.
The map is exact in Firestore. Its download is a JSON representation for recovery;
native Firestore values in unfamiliar metadata are not a type-exact Firestore
export/import format.

## Review requirements used for the combined release

- Every input PR is included at its verified head; integration preserves both the
  export lifecycle and course information inside comparison dialogs.
- Ownership, malformed retired fields, metadata preservation, repeated decoding,
  unknown versions and old baseline conversion have focused executable checks.
- Recovery tests cover preservation failure, primary-write failure, interruption,
  retry, accessible originals, preference reset and confirmed workspace reset.
- Actual browser controls cover legacy/multi-plan migration, annual edits, imports,
  quota notices, exports/focus, stale comparisons, sync pause/resume and delayed
  cloud application in Chromium, Firefox and WebKit.
- Firestore emulator checks cover competing clients, account isolation, current
  schema/revision enforcement, obsolete writers and failed local completion.
- The complete integrated regression suite, lint, type checks and build pass.
- Fresh independent reviewers challenge the implementation and verification scope;
  findings are fixed and rechecked before a final release review.

## Limits and release boundary

The localStorage transaction rewrite remains deferred. Cross-tab writes can race;
old JavaScript can interpret or overwrite retired fields using old rules. Retaining
the original bytes and rechecking observed state do not provide cross-tab atomicity.
Users must refresh older clients after the release. The migration supplies
one consistent interpretation to this client and crash/failure recovery, not a
history service or protection from noncooperating old code.

No live account data is used for automated testing. Compatible Firestore rules
were published before the #39 client. Subsequent real Chrome checks verified
sign-in, automatic upload, explicit restore and persistence; see
[verification](verification.md) for their exact scope and the #40 follow-up.

## Validation recorded on 2026-10-30 at `058dff2`

| Check | Result and scope |
| --- | --- |
| Unit tests | 200 passing tests, 12,660 assertions across 23 files |
| Type checking, lint, production build, diff whitespace | Passed; existing dependency-annotation and bundle-size warnings remain |
| Complete Chromium application suite | All 20 browser scripts passed, including the existing export, catalog, annual-course, interaction and stale-control regressions |
| Firefox and WebKit | Migration, reviewed sync, annual stale controls, two-tab stress, export context, focus and print suites passed in both engines |
| Two local production builds | Desktop/mobile DOC or ZIP, PNG and clipboard-adapter exports survived replacing the served build; no deployment occurred |
| Firestore emulator | 10 passing tests, including the actual application exchange/accept boundary, competing clients, account isolation, original retention, future-envelope rejection and failed local completion |
| Independent recovery probes | Second-migration interruption, failed promotion, later-write settlement, failure at every reset deletion, denied reads/enumeration and successful retries passed |
| Independent integration review | Decoder ownership, legacy baseline interpretation, preserved metadata, source-bound duplication, provider placement and strict cloud-envelope handling had no remaining actionable findings |
| Visual inspection | Phone and desktop comparison, major deltas, merge preview and the separate cloud-original download inspected with synthetic data |

The cross-tab tests demonstrate stale-render protection and the source-bound
duplicate flow. They do **not** demonstrate atomic simultaneous local writes.
Cloud browser tests use a synthetic service; emulator tests use the actual
application transaction with its Firebase connection redirected to a demo project.
No test used live account data. Clipboard API calls were intercepted; native
system clipboard behavior was not checked. Chromium PDF generation and all three
engines' print layouts were checked; native Firefox/WebKit print dialogs were not.

At this historical validation point, the original PR heads in the input table
were still open and unchanged. They were later incorporated into #39; PRs #35–38
are now closed. Release approval, the server-rules/client rollout and subsequent
real-account sign-in/sync checks are recorded in [verification](verification.md).

## Custom-catalog and receipt-documentation follow-up

Regression tests reproduced the lost source precedence before the decoder fix.
The fix validates every candidate before comparing catalog source order; malformed
array candidates also have a failing-before/passing-after check. Equal precedence
with reordered inner fields still migrates successfully. Rejected copies retain
their exact original bytes and remain downloadable from recovery.

Validation: 204 unit tests / 12,686 assertions, type checking, lint and production
build passed. The migration browser suite passed in Chromium, Firefox and WebKit,
including the new conflicting-order recovery fixture. Two independent reviewers
rechecked the fixes and closed their findings. The receipt documentation now
accurately distinguishes manual review from automatic retry; runtime sync behavior
is unchanged. Earlier broad validation above remains attributed to its original
commit rather than claimed as a fresh local run.
