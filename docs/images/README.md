# Documentation images

This directory holds image assets used in the project's documentation — README
screenshots, diagrams, and the like. They are **documentation** assets, not part
of the web app (`apps/web/`) or API (`apps/api/`) builds, so they live here under
`docs/` rather than inside either package (and so they never touch the web
bundle-size gate).

Reference them from Markdown with a repo-relative path — e.g. from the root
README: `![Directory view](docs/images/directory.png)`.

## Two rules for anything added here

- **Fake data only — never real member PII.** This repository is public. Capture
  screenshots from **staging** (`pbe-book-staging.web.app`, fake data by design),
  never from production. Confirm no real name, email, or address is visible
  before committing.
- **Optimize for the slow-connection audience.** Book's readers skew 60+ and many
  are on slow links. Compress and right-size images before committing (PNG for UI
  screenshots, sensible dimensions, run through a lossless optimizer) — keep the
  repo and any doc pages byte-frugal.
