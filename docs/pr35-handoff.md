# PR #35 handoff

## Agreed scope

[PR #35](https://github.com/noam-isaac/dib-it/pull/35) prevents a stale rendered control from replacing newer, already-saved workspace edits. Keep that scope unchanged. Cross-tab transactional coordination is a separate architectural follow-up and is not part of this PR.

The original production and regression-test baseline is commit `76c606ad7eca60cc386c746d28c1295a82efefa4`, validated by [CI run 40693989813](https://github.com/noam-isaac/dib-it/actions/runs/40693989813). The initial handoff added documentation and optional diagnostics only. A later independent review found that accepted backups can override the workspace semester inside a plan. `useDibIt` now binds its updater to the same active view it returns; the browser regression covers annual deselection and deletion with conflicting plan/workspace semesters. The saved-data shape is unchanged. Verify the current PR head before continuing, including when integrating the persistence follow-up.

The branch is `codex/atomic-workspace-updates`, based on `codex/immutable-react-state` / [PR #33](https://github.com/noam-isaac/dib-it/pull/33). Do not merge, retarget, delete dependency branches, or publish as part of taking over this investigation.

## What is implemented

- `src/models.ts:updateDibIt` reads the latest saved workspace before invoking a functional updater; callbacks from a different active plan are rejected.
- `useDibIt` captures the originating plan and edit semester. Course actions use course IDs rather than stale array positions and cannot recreate a removed course.
- `src/plans.ts:updateActivePlan` derives annual intent from the edited semester separately from current navigation. Pending annual operations survive incomplete catalogs and replay when data arrives.
- All production workspace editing callers use this boundary. Explicit migration, restore, synchronization, and plan-management replacement boundaries remain separate.

## Verified evidence

At the baseline commit, all 158 PR-local unit tests pass (12,390 assertions), including 24 new tests and 1,024 annual-group combinations. The two-tab stress suite passes Chromium, Firefox, and WebKit at 1280px and 390px with Node 22. Negative controls fail against the old snapshot and semester behavior.

An isolated combination of PRs #32–37 also passed `bun run check`: 160 unit tests, lint, type checking/build, all browser suites, and deployment-export checks. Existing assertions and timeouts were unchanged. Earlier intermittent local timeouts remain unexplained; a passing rerun does not establish their cause.

Use the committed Bun lockfile and Node 22, matching CI:

```sh
bun install --frozen-lockfile
bun test
bunx node@22 tests/browser/atomic-updates.mjs
bunx node@22 tests/browser/atomic-stress.mjs
DIBIT_BROWSER=firefox bunx node@22 tests/browser/atomic-stress.mjs
DIBIT_BROWSER=webkit bunx node@22 tests/browser/atomic-stress.mjs
```

The regular `bun run check` command includes the new stress suite; run it with Node 22 on PATH. Browser engines must already be installed or installed through the project's documented Playwright commands.

## Deferred simultaneous-write limitation

Reading fresh storage is not a transaction across tabs. Two tabs can both read W, derive W+A and W+B, then successfully save their own whole snapshot; the later save discards the other edit. Storage notifications reread the winner and do not recover the discarded operation. Google sync is not an edit history and cannot reliably restore it.

The initial Chromium investigation used synthetic catalogs, native localStorage, and real checkbox handlers:

| Investigation | Recorded outcome |
| --- | --- |
| Pause both handlers after reading W, resume in either order | First writer's edit lost; verified after both tabs reload |
| Unchanged source, 200 deliberately simultaneous scheduled clicks | 106 trials lost an edit; both tabs agreed after settling, first loss persisted after reload |
| Temporary Web Lock around the complete ordinary update | 0 losses in 200 trials; first and last trials retained both edits after reload |

Environment: Chromium 153.0.8010.12, Playwright 1.63.0, Node 22.23.4 on macOS. Counts are stress-test observations, not ordinary-use incidence or a cross-browser guarantee.

The original temporary artifacts are not required. Portable copies are versioned here:

```sh
bunx node@22 scripts/diagnostics/concurrent-tab-writes.mjs
bunx node@22 scripts/diagnostics/concurrent-tab-lock-prototype.mjs
```

Each command prints a newly created temporary output directory containing JSON evidence; the first can also save a screenshot. They use a local server and isolated synthetic browser storage. The first command deliberately reproduces the known limitation; completing it successfully does not mean writes are safe. The second changes scheduling through a temporary Vite transform only. Neither diagnostic is part of normal CI or changes repository source on disk. They are coupled to the current updater boundary and must be reviewed if that boundary changes.

## Follow-up design constraints

Present one concrete proposal and risk estimate before implementation. An exclusive native Web Lock around the full read/derive/validate/write operation is a candidate; locking only the final `setItem` is insufficient. Preserve the saved-data format unless a separate migration is approved.

All participating writers need review: `updateDibIt`, `reconcileCatalogs`, legacy migration, `PlanSelector` operations, `RestoreScheduleModal`, automatic Google synchronization, empty-workspace initialization in `useLocalStorage`, and workspace reset. Keep network requests and dialogs outside a lock.

A queued cloud download must recheck its expected local key inside the lock, derive retained navigation from the then-current workspace, and report applied/skipped before synchronization remembers its base or reports success. Merely making `setWorkspace` asynchronous would weaken the current protection. Restore/migration completion, failures, and UI callbacks also need explicit asynchronous handling.

Old already-open app versions will bypass a new cooperative lock. Browser support, unsupported-browser behavior, and an old-tab reload policy require explicit decisions; do not silently fall back to uncoordinated writes. The prototype covers ordinary edits only and settles none of these production decisions.

## Remaining work outside this follow-up

- PRs #32, #33, and #34 have passed their current-head CI and prior code review; no external review comments were open when this handoff was prepared.
- The user approved the approaches for PRs #36 (React-owned exports) and #37 (course-focus readiness). Independent review subsequently found and prompted fixes for the accepted-backup issue above and #37's delayed-focus cancellation. Required checks and release review must cover those updated commits.
- After approvals, prepare and show the working previews, handle dependency/retargeting and any real merge conflicts, rerun required checks on the resulting commits, and obtain release approval before merging/publishing.
