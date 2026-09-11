# Open problems

## UI changes awaiting user review

Production is commit `7e4e1bb` (PR #10). The following changes were shipped without a separate visual/design review; the correction preview must be approved before another production deployment.

| Change from previous production (`b944076`) | Current disposition |
| --- | --- |
| Active schedule-name button above the semester selector, despite its earlier removal | Removed in correction preview; switching remains in the actions menu. |
| Automatic foreground colors on scheduled course cards and exam labels; colored exam/practice text replaced by borders | Original screen colors restored in correction preview. Only courses without selected hours retain the requested neutral/dashed indication. |
| Header, page title, metadata, favicon and footer branding | Requested name “דיביט של נועם” applied in correction preview. |
| First-visit introduction modal and footer “what changed” button | Still present; needs user review. |
| Mobile course-list show/hide button | Still present; needs user review. |
| Footer/contact links and guide/Word-export wording | Still present; needs user review. |
| PDF defaults changed to A4 portrait, 10 mm margins, white paper and adaptive timetable height | Working output verified; layout choice needs user review. |
| Daily annual-data workflow, automatic public-feed refresh, classification status/retry in Settings, and deferred edits for unclassified years | Workflow and public feed are live; cadence and new UI need user review. |
| Bidding course-to-faculty overrides now reset when its modal closes | Needs user review; point budgets remain saved. |
| Practice panels use stable course IDs instead of list positions | Fixes wrong-panel identity; old expanded-panel positions are not migrated and will initially be collapsed. |

The annual-data activation blocker has been removed: workflow run `34281220711` succeeded and its public version-1 feed contains verified classifications for 2023–2027. This does not establish future scheduled-run reliability.

Real-account Google sign-in/sync was not checked; the user declined. Automated cloud checks used the Firestore emulator.

## Full fork review — 2026-09-09

Compared the complete checkout with upstream `arazimproject/dib-it` at
`9216632abdc56ae8d224fa392d4c22703cd29b8f`, verified against its public `main`.
The final reviewed fork revision is `b82c0f720e819cb6948bce11982fdd6a5c5312e6`;
the review also includes the untracked `pnpm-lock.yaml` and
`pnpm-workspace.yaml`. That revision arrived during the review and incorporates
the initially uncommitted UI corrections. The approval items above remain open.

Alignment was assessed against the README, maintenance instructions, documented
feature history, preservation of existing user data, and the smallest implementation
that meets those requirements. A feature's presence in documentation establishes
its intended behavior, not approval of the unresolved product choices above.

### Status — 2026-09-11

| Finding | Status |
| --- | --- |
| R01 P1 recovery deletes schedules | **Resolved** — PR #19. Non-essential preferences self-heal at the read boundary; the workspace opts out via `essential`; recovery leads with a preference-only reset. Reproduced before and after. |
| R04 P2 Lautman entries block Word export | **Resolved** — PR #13 excluded them; PR #15 made every unusable row degrade and report instead of failing. |
| R08 P2 untracked pnpm baseline | **Resolved** — both files removed on 2026-09-10. `bun.lock` is the only lockfile. `dx-regressions.mjs` was changed under the drifted install to click the switch input; consider restoring the label click once local installs use Bun. |
| R10 P2 no release-path validation | **Resolved** — PR #20 adds `validate.yml` (frozen Bun lockfile; lint, build, unit, browser). Branch protection on `main` requires it. The review had not inspected protection; `main` had none. |
| R16 P3 duplicated registration checks | **Resolved** — the duplicate `checkText` calls were removed in the PR #15 rewrite of `validate`. |
| R02, R03, R05, R06, R07, R09, R11–R15 | **Open.** An uncommitted, in-progress working-tree change on 2026-09-11 touched R02/R03 (`annualCourses.ts`, `plans.ts`), R12 (`normalizePlans`), R14 (`Sidebar.tsx`, `useWorkspace` signature) and R15 (`syncAnnualCourses` removed). It is preserved on branch `wip/uncommitted-on-main-2026-09-11` as a partial snapshot and is not verified. |

### Coverage and justified changes

All 88 tracked changed paths and both untracked package-manager files were reviewed,
including source callers, scripts, deployment/security configuration, test fixtures,
documentation, and template identity/integrity checks.

| Area | Assessment |
| --- | --- |
| Plans, shared settings, legacy migration, backup validation and restore preview | Justified by multiple independent schedules and safe replacement; remaining issues below. |
| Exam collection/search, calendar export, Hebrew search and academic shortcuts | Match documented functionality. Shared exam identity, date parsing and native date inputs are appropriate. |
| Original Word form, preparation script, manifest and ZIP dependency | The binary writer is justified by the explicit requirement to retain the supplied DOC. Replacing it with a newly constructed document would violate that requirement. SHA256, byte-slot checks and overflow tests should stay. |
| Annual classification, registry, scraper, workflow and fallback data | Verified classification and durable offline intent justify the mechanism. The 12,559-line JSON is generated source data, not 12,559 lines of application over-engineering. Cadence/UI approval remains open above. |
| Automatic sync, manual backups, auth configuration and Firestore rules | Account-scoped access, explicit opt-in, transactions and conflict handling are justified. Whole-workspace conflict resolution is an explicit current contract; a distributed merge framework is not automatically required. |
| Loading/retry handling, accessibility controls, print styles, bidding and practice fixes | Functional fixes are justified. Previously identified visual/default changes still require the review recorded above. |
| Fork branding, guide, setup and maintenance documentation | Independent attribution and corrected links are justified; existing approval items remain separate from technical correctness. |
| Tests and build tooling | Regression coverage is useful; dependency drift, live test inputs and missing automation are detailed below. The inherited bundle-size warning alone is not a new fork defect. |

### Correctness and architecture findings

#### R01 — P1: Recovery can delete schedules without recovering the app

Location: `src/main.tsx:172–177`, `src/hooks.ts:3–6`,
`src/components/Schedule.tsx:57–60`.

The revised reset removes `Dib It`, `Dib It Sync` and `Hidden Tabs`, but leaves
other application preferences that are parsed without protection. Reproduced in
Chromium: set `Compact View` to `broken-json`, reload, and confirm reset. The saved
courses disappear, the corrupt preference remains, and the error screen returns.
`Sidebar Compact` is another affected key. The recovery download contains only the
workspace, so it also omits the actual failing preference.

Smallest fix: tolerate/reset malformed nonessential preferences at their read
boundary and distinguish preference recovery from deleting schedules. Preserve
unrelated origin storage. Add the corrupt-preference case to the existing recovery
test; the current test covers only an invalid workspace.

#### R02 — P2: Reclassification can leave annual edits permanently pending

Location: `src/annualCourses.ts:63–73`, `src/annualRegistry.ts:23–27`.

The feed can replace a year's classification, but a pending operation created while
the course was classified annual has no `awaitingClassification` flag. If a later
verified feed removes that course/group, the operation bypasses the nonannual exit
and waits forever for an annual group that no longer exists. This also occurs if a
custom source defining an annual course is removed while an operation is pending.

Reproduced with a synthetic year: queue a removal before the other catalog arrives,
accept a newer classification without that course, then provide both complete
catalogs. The pending removal remains. The existing tests cover unknown-to-known
classification, but not corrections to a previously known classification.

Smallest fix: distinguish unavailable classification from authoritative removal,
and resolve or explicitly surface obsolete operations without silently inventing a
cross-semester edit. Cover annual-to-nonannual and removed-group transitions.

#### R03 — P2: One pending annual course blocks unrelated reconciliation

Location: `src/plans.ts:51–59`, particularly the `pending.length` branch.

Any pending operation disables all missing-course reconciliation in the active
plan, including unrelated courses and other years. For example, a pending removal
for an unavailable old-year course prevents a saved, fully verified current-year
annual course from appearing in the other semester. R02 reproduces this with two
courses, but a legitimate prolonged catalog outage causes the same coupling.

Smallest fix: suppress resurrection only for the course/year combinations with
pending operations. Keep the removal safeguard; remove the plan-wide barrier.

#### R04 — P2: Built-in Lautman entries block the entire Word export

Location: `src/lautmanCourses.ts:3–16`, `src/registration.ts:36–51`,
`src/registrationDocument.ts:32–43,107–121`.

`L1` and `L2` are deliberately local scheduling IDs. They are nevertheless included
in registration rows and grouped into a registering department using their prefix.
The exporter then rejects that department because it is not four digits, before
even reaching the eight-digit course validation. Reproduced with selected `L1/01`;
mixing it with official courses blocks their export too. The form offers no way to
exclude a row without changing the schedule.

Smallest fix: distinguish scheduling-only entries in the registration preview and
offer an explicit exclusion or official-ID mapping. Do not fabricate course numbers
or silently drop courses. Test a mixed official/Lautman schedule.

#### R05 — P2: Exam-search navigation cannot reveal collapsed courses

Location: `src/components/ExamSearch.tsx:59–72`,
`src/components/Sidebar.tsx:32,272–282`.

The search action adds/finds the course and calls `scrollIntoView`, but the mobile
collapse state belongs exclusively to Sidebar. Reproduced at 390 px: collapse the
course list, open exam search and press “בחירת קבוצות”. The target remains inside
`display: none`. Adding a new result has the same problem. Sidebar's own search
does expand the list, so the entry points disagree.

Smallest fix: have both entry points reveal the course list before scrolling, and
focus the group's control for keyboard users. Add this combination to the existing
mobile interaction test.

#### R06 — P2: A failed cloud listener can be hidden by a successful transaction

Location: `src/components/GoogleScheduleSync.tsx:46–56,63–75`,
`src/scheduleSync.ts:95–100`.

The snapshot error callback sets an error message but does not recreate the
listener. A later focus/online/local-edit transaction can succeed and set `synced`,
hiding the error even though no listener remains to receive remote edits. The
30-second retry also belongs to transaction failures, not listener failures.
Firebase documents that a listener receives no further events after its error
callback. This finding is based on the code path and the
[official listener lifecycle](https://firebase.google.com/docs/firestore/query-data/listen#handle_listen_errors),
not a live-account experiment.

Smallest fix: reconnect the subscription through the existing retry lifecycle and
retain the error until listening is restored. Test a terminal listener error
followed by a successful transaction and another device's update.

#### R07 — P2: Unbounded workspaces exceed the single-document sync contract

Location: `src/components/GoogleScheduleSync.tsx:37–43`,
`src/components/GoogleSaveButtons.tsx:45–49`, `src/scheduleBackup.ts`,
`src/scheduleSync.ts:96–100`.

Every plan, semester, custom catalog and practice record is placed in one Firestore
document. No capacity check distinguishes a locally valid workspace from a cloud
compatible one. Reproduced locally: a custom catalog with a 1,100,000-character
name passes backup validation. It cannot fit Firestore's
[1 MiB document limit](https://firebase.google.com/docs/firestore/quotas#collections_documents_and_fields).
More ordinary imported catalogs and duplicated plans can reach the same aggregate
limit. The sync baseline additionally stores a complete canonical copy in
localStorage, and permanent write failures retry every 30 seconds.

Smallest fix: define and communicate the supported cloud payload limits, preserve
local/file operation, and stop automatic retries for permanent size/shape failures
until data changes. Split storage only if supporting larger workspaces is a real
requirement; do not introduce a new backend just to avoid stating the ceiling.

#### R08 — P2: The untracked pnpm files create a second, incompatible dependency baseline

Location: `pnpm-lock.yaml`, `pnpm-workspace.yaml:1–5`, `vercel.json:4–5`,
README “Developing”.

Deployment and documented installation use the committed Bun lockfile. The pnpm
lock resolves different versions, including Mantine 8.3.18 instead of 8.0.2,
React 19.2.8 instead of 19.1.0, and Vite 6.4.3 instead of 6.3.5. The workspace file
also contains literal `set this to true or false` placeholders for four build
permissions. This is an unfinished parallel setup, not a reproducible migration.

The difference is observable: the current installed tree fails
`tests/browser/dx-regressions.mjs:76` because the switch input intercepts the text
locator. Both scenarios pass in a clean temporary checkout installed with
`bun install --frozen-lockfile`. Do not report that failure as a committed Bun
baseline regression.

Smallest fix: remove these two untracked files unless an explicit package-manager
migration is intended. A migration must update installation/deployment commands,
resolve build permissions, retain one authoritative lockfile and pass the suite.

#### R09 — P2: Synthetic browser tests still consume the changing public annual feed

Location: `tests/browser/regressions.mjs:52–58`,
`tests/browser/annual-courses.mjs:22–31`,
`tests/browser/annual-courses-audit.mjs:25–34`, `src/App.tsx:70–72`.

These suites intercept Arazim catalogs but leave the new raw GitHub annual-feed
request live. Consequently, a daily publication can change the classification
under an otherwise fixed test, and running without network can exercise a different
fallback path. The annual tests also omit the explicit local-mode override used by
the other suites. Existing fresh browser contexts prevent an authenticated session
here, but the test setup still depends unnecessarily on developer configuration.

Smallest fix: fixture or abort every external request and explicitly disable auth
in non-auth suites. Reuse a small common server/routing setup where it eliminates
the existing repetition; keep specialized failure scenarios explicit. A separate
opt-in public-feed smoke check can verify the real endpoint.

#### R10 — P2: Added regression coverage is not connected to the release path

Location: `.github/workflows/annual-data.yml`, `package.json:11–16`,
`vercel.json:5`.

The only committed Actions workflow refreshes annual data. Neither the deployment
script nor the Vercel build runs the new unit or browser tests or lint. A change to
backup replacement, annual replay or cloud conflict handling can therefore build
and publish while its regression suite fails. This is a repository automation gap;
remote branch-protection settings were not inspected.

Smallest fix: add a PR check using the authoritative frozen lockfile and the
existing validation commands, then make its release status explicit. Keep visual
approval from the opening section as a separate requirement. Reuse the existing
tests rather than adding another test framework.

### Smaller correctness and code-waste findings

#### R11 — P3: “Hours in the schedule” and visible lessons use different rules

Location: `src/utilities.ts:113–126`, `src/components/Schedule.tsx:83–88`,
`src/components/CourseCard.tsx:35–36`.

The shared hour counter checks times but ignores the day; the timetable requires a
supported day. A selected custom lesson with `time: "09:00-10:00"` and no day is
accepted by import validation, counts as one hour, and makes the course look
scheduled, but draws no event. This was reproduced directly. The old counter also
ignored days; the new use of that result for the neutral/dashed card state extends
the inconsistency to the fork's new UI promise.

Smallest fix: use the same eligibility rule for the hour total and visible lesson
state. Retain optional/incomplete imported catalog fields; do not pretend they are
visible timetable hours. Adjust the current hours test, which omits days entirely.

#### R12 — P3: Normalization repeatedly overwrites a valid user-selected plan name

Location: `src/plans.ts:16–20`.

Rename the default plan to `התוכנית שלי`: `renamePlan` accepts it, but the next
`normalizePlans` changes it to `מערכת השעות שלי`. Reproduced directly. The migration
is applied on every read, so that text is effectively a forbidden custom name and
every component repeatedly maps all plans to perform the same check.

Smallest fix: leave existing custom names alone, or make any necessary migration a
one-time operation distinguishable from later user edits. New default names are
already supplied when creating the legacy plan.

#### R13 — P3: Search rebuilds the entire index for every text query

Location: `src/search.ts:12–27`, `src/App.tsx:88–91`,
`src/components/ExamSearch.tsx:51–55`.

`new MiniSearch` and `addAll` run on every nonnumeric search, including every
keystroke through the global dropdown filter. The result limit is applied only
after indexing and searching. In a synthetic 10,000-label run, five warmed calls
took 27.7–29.5 ms each on this machine; this is a measured synthetic cost, not a
claim about production latency. The exam-search memo still rebuilds on every query.

Smallest fix: retain the index while the actual option/catalog data is unchanged
and apply the numeric restriction to matches. Keep MiniSearch and its Hebrew tests;
reimplementing fuzzy search or introducing a search service would add complexity.

#### R14 — P3: Sidebar subscribes to the same workspace twice, and the hook exposes an unused writer

Location: `src/components/Sidebar.tsx:37–39`, `src/models.ts:26–33`.

`useDibIt()` already calls `useWorkspace()`, then Sidebar calls it again to obtain
the active plan name and pending state. This duplicates storage listeners, parsing
and normalization for the same component. Every current caller of `useWorkspace`
also ignores its returned setter, while that setter duplicates `setWorkspace`'s
reconciliation path.

Smallest fix: read one workspace in Sidebar and derive its active view; keep the
existing shared write function. Make the workspace hook read-only until a caller
actually needs a second write API. No new state-management dependency is needed.

#### R15 — P3: A production annual-sync wrapper exists only for tests

Location: `src/annualCourses.ts:114–117`, `tests/annual-courses.test.ts`.

`syncAnnualCourses` has no application callers. It returns only `.courses`, dropping
the pending intent that makes the real `updateActivePlan` flow safe. Seven tests
exercise this alternate shortcut instead of the production entry point, alongside
the more representative lifecycle tests.

Smallest fix: delete the test-only production export and preserve the official
catalog counterexamples by exercising the actual plan update/reconciliation path.
Do not delete those useful test cases merely to reduce line count.

#### R16 — P3: Registration validation repeats two identical checks

Location: `src/registrationDocument.ts:47–48`.

`checkText(details.studentName)` and `checkText(details.degree)` have already run at
lines 29 and 31, and neither field changes in between. Delete the two trailing
calls. Keep the earlier required-value/control-character checks and the public
template-filling boundary validation.

Complexity accounting: `net: -2 lines possible` immediately for R16. R12, R14 and R15
identify further removable production work; their final net depends on preserving
the relevant behavior/tests. The 3,342-line alternative lockfile is accounted for
separately in R08, not presented as application-code savings.

### Verification and limits of this review

- Exact committed Bun dependency baseline, in an isolated temporary checkout:
  `bun install --frozen-lockfile`, 72 unit tests, lint, TypeScript/Vite build and all
  eight Chromium browser scripts passed. Bun was invoked through a temporary
  `pnpm dlx bun` runner because no Bun executable was on the shell path; this did
  not migrate the repository or alter its dependencies.
- Current installed dependency tree: 72 unit tests, lint and build passed; the
  browser suite failed at the switch locator described in R08. Remaining print,
  interaction and annual-feed scripts passed when run separately.
- `python3 scripts/refresh-annual-courses.py --self-test` passed. The public annual
  feed was fetched read-only and contains version-1 records for 2023–2027, dated
  2026-09-08. This corroborates the existing activation update above; it does not
  establish future scheduled execution or a new deployment's identity.
- Additional synthetic checks reproduced R01–R05, the oversize acceptance in R07,
  R11 and R12. R06 is a traced lifecycle defect supported by Firebase's documented
  listener behavior; R09–R10 are test/release configuration findings. R13 includes
  a small synthetic timing check. R14–R16 were verified by caller/reference review.
- Firestore emulator integration tests were inspected but not rerun: this
  environment has no Java runtime. No installation, real account access, cloud
  writes, release, or new Word rendering was performed. Existing DOC checksum and
  byte-integrity tests passed; prior native Word evidence remains historical.
- Only this report was edited for the review. No finding has been fixed or given
  release/design approval by being listed here.
