# Catalog identity and verification

The external JSON feed remains unchanged. `src/catalog.ts` imports it into
`CatalogCourses`: course IDs map to semester-scoped course records, whose group
IDs map to `CatalogGroup` records. The TypeScript consumers use this internal
model rather than searching or summing raw group arrays.

## Import contract

- Identity is academic semester (including year), course ID, and group ID.
- Repeated records resolve to one original record only when their lecturer and
  lesson multiset match. Lesson order and object-property order do not matter;
  every lesson field and the number of occurrences do matter.
- Differing records remain a `conflict` containing the original records. The
  importer does not concatenate lecturers, union lessons, or choose a winner.
- Rows without a group ID remain in `unidentifiedGroups`; no ID is invented.
- The shared input validator accepts nullable lecturers found in the public feed.
- Normalization is pure. Raw custom catalogs and saved schedule/backup formats
  are preserved. There is no source migration or external data write.
- `Map.groupBy` uses the targeted `core-js/es/map/group-by` polyfill.

## Conflicts in the application

Users can select or deselect a known group ID even when its records conflict.
Selections survive reloads and source corrections. Conflicting lesson records
are not displayed as a timetable or counted as known hours; the total is marked
partial and the timetable explains the missing groups. Calendar, Word, and
schedule-image/PDF menu exports are disabled for affected selections. Calendar
and registration builders also reject conflicts, preventing bypass by a caller.

Course-level exam data remains available independently of conflicting lesson
records. Annual classification and selection synchronization remain separate
from timetable availability, including for explicitly annual custom courses.

## Real-data audit (2026-09-12)

All ten public catalogs from `courses-2023a.json` through `courses-2027b.json`
were downloaded from `https://arazim-project.com/data/` and audited: **34,299
course records, 58,668 source group records, and 56,112 unique group
identities**. The model retained all seven conflicting identities without merging
their records. Both French beginner groups have four weekly hours in every
semester in this audit.

| Semester | Courses | Source groups | Unique groups | Conflicts |
| --- | ---: | ---: | ---: | ---: |
| 2023a | 3,553 | 6,023 | 5,907 | 1 |
| 2023b | 3,580 | 6,025 | 5,892 | 3 |
| 2024a | 3,476 | 6,091 | 5,968 | 0 |
| 2024b | 3,459 | 5,783 | 5,657 | 0 |
| 2025a | 3,429 | 5,945 | 5,762 | 0 |
| 2025b | 3,458 | 5,798 | 5,608 | 0 |
| 2026a | 3,393 | 6,196 | 5,747 | 1 |
| 2026b | 3,345 | 5,706 | 5,275 | 1 |
| 2027a | 3,296 | 5,670 | 5,251 | 1 |
| 2027b | 3,310 | 5,431 | 5,045 | 0 |

`tests/fixtures/catalog-history.json` contains unmodified representative course
excerpts, independent expected outcomes, full-source SHA256 fingerprints, URLs,
and counts. It includes annual courses, semester-only courses, all conflicts,
and equivalent records with reordered lessons. It is a regression fixture,
not a production data source or classification index.

## Verification

- Unit coverage: explicit equality and conflicts, malformed input, nullable
  lecturers, unnamed groups, frozen input, repeated selections, semester/year
  isolation, custom catalogs, backup round trips, and corrected source records.
- Annual lifecycle checks for every semester: delayed catalogs, pending changes,
  removals, reload/restore, and isolation between years and schedule plans.
- Chromium, Firefox, and WebKit: all ten semesters, desktop/mobile layouts,
  actual ICS and binary DOC downloads, correct Word year/semester fields,
  annual switching, reload, and deselection. Semester-B runs disable native
  `Map.groupBy` to exercise the polyfill.
- All seven real conflict cases in all three browser engines: visible warnings,
  export blocking, editable/preserved selections, and recovery after correction.
- Full project checks include the existing loading, sync, annual feed, search,
  practice, registration, and print regressions. Mobile screenshots were inspected.

Run the offline suite with `bun run check`. To repeat the full-feed audit against
exact downloaded snapshots named `courses-YYYYs.json`:

```sh
DIBIT_CATALOG_DIR=/path/to/catalogs bun test
DIBIT_BROWSER=firefox node tests/browser/catalog-history.mjs
DIBIT_BROWSER=firefox node tests/browser/catalog-conflicts.mjs
DIBIT_BROWSER=webkit node tests/browser/catalog-history.mjs
DIBIT_BROWSER=webkit node tests/browser/catalog-conflicts.mjs
```

Full-feed fingerprints intentionally detect changed upstream snapshots; the
committed representative regression suite needs no network access.

## Performance and loading check (2026-09-12)

Using the ten full snapshots above, Chromium imported each catalog in a median
1.7–2.0 ms on the development machine (five warmups, fifteen measured runs).
The lesson comparison is quadratic only within a repeated group's lesson list:
99% of the 58,668 source rows have at most three lessons, and the maximum is 17.
Single records skip comparison with themselves. Course/group access uses IDs.

An intermediate implementation unnecessarily reimported all custom courses for
each annual check. A synthetic selection of 20 courses with the full 2027a
catalog installed as a custom source took a median 231 ms per `updateActivePlan`
in Bun. Direct course-ID lookup reduced the same benchmark to 0.03 ms. The
annual regression test rejects whole-source enumeration and checks precedence.
These are computation measurements, excluding rendering, storage and network.

A fresh isolated Chromium session on production showed the timetable in 1.8 s,
with the semester request taking 1.2 s. This single observation is not evidence
of a historical slowdown. Holding that request reproduced false zero hours and
an unavailable-course card. The loading regression now checks unknown hours,
deferred course details, disabled catalog-dependent exports, and available
backup/semester controls through delays, year switches, stale responses and
failure/retry on desktop/mobile in Chromium, Firefox and WebKit.

Catalog responses are validated before entering the fetch cache. Rejected data
is discarded so Retry requests corrected data, including historical practice
catalogs whose failures stay within the practice panel. Lecturer labels fall
back to other groups when lecture groups contain no usable lecturer names.
The six browser validation cases reproduce five failures against the prior
code (plus a passing precedence control) and pass in all three browser engines.
