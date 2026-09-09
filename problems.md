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
