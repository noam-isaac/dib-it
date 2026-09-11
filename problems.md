# Open problems

## Product decisions awaiting review

| Item | Decision still needed |
| --- | --- |
| First-visit introduction modal and footer “what changed” button | Review whether to retain them. |
| Mobile course-list show/hide button | Review whether to retain this control. |
| Footer/contact links and guide/Word-export wording | Review the current links and wording. |
| PDF defaults: A4 portrait, 10 mm margins, white paper and adaptive timetable height | Review the layout defaults; output works. |
| Annual-data refresh and classification UI | Review the daily cadence, automatic public-feed refresh, Settings status/retry, and deferred-edit messaging. |
| Bidding course-to-faculty overrides | Decide whether overrides should continue resetting when the modal closes; point budgets remain saved. |
| Previously expanded practice panels | Review the one-time collapse of old position-based expansion state after switching to stable course IDs. |

## Outstanding verification

- Firestore emulator integration tests remain unverified locally because Java is
  unavailable. They are an optional separate check, not part of CI.
- Real-account Google sign-in/sync remains untested; the user previously declined
  that check. Existing browser sync coverage uses synthetic Firebase data.
