# TAU Tools submodule

`tau-tools` points to [our fork](https://github.com/noam-isaac/tau-tools) of
[Arazim's TAU Tools](https://github.com/arazimproject/tau-tools). It has its own
Git history; Dib It records only its repository URL and pinned commit.

For a fresh Dib It clone, use `git clone --recurse-submodules`. For an existing
clone, run `git submodule update --init --recursive` from the Dib It root.

Commit and push TAU Tools changes inside `vendor/tau-tools` first. Then commit
the updated `vendor/tau-tools` pointer in Dib It. Pushing Dib It does not push
the nested repository's commits.

The submodule's `origin` is our fork. To fetch changes from Arazim, add its
remote once in each clone:

```sh
git -C vendor/tau-tools remote add upstream https://github.com/arazimproject/tau-tools.git
git -C vendor/tau-tools fetch upstream
```

The fork's static dataset deployment is https://tau-tools.vercel.app, with files
under `/data/`. The configured weekly GitHub workflow (Saturday, 22:23 UTC) refreshes the
newest academic year's schedules, exams, prerequisites and plans from TAU, with other
supplementary feeds from Arazim. Scraping stops by 04:00 UTC (06:00/07:00 Israel),
including delayed or manually requested refreshes. Publication occurs only after the complete refresh and build
succeed. See the fork's README, workflow history, and `snapshot.json` for the
last successful refresh and source provenance.

Dib It reads JSON through `/data/` on its own origin. Its Vercel routing rule
proxies that path to the data deployment; Vite does the same for local development
and preview. The fork's public URL remains the proxy's upstream destination.
These requests are independent of this submodule's pinned commit.
Weekly dataset publications therefore do not require a Dib It commit or
deployment. Switching the app's data host takes effect after releasing the
app change.

Generated datasets are ignored by Git and deployed directly from the local build
to Vercel, without a separate GitHub Actions artifact. The Tools workflow is paused
for review of the storage migration; the existing published snapshot stays live.
See the TAU Tools PR and `CHANGES.md` for the cleanup and activation requirements.

Annual groups and exam snapshots also come from `/data/annual-groups.json`.
The corresponding scraper and its offline self-tests live in TAU Tools'
`tau_tools.annual` module, run by the same weekly publication workflow.
