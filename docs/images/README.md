# Documentation images

This directory holds image assets used in the project's documentation — README
screenshots, diagrams, and the like. They are **documentation** assets, not part
of the web app (`apps/web/`) or API (`apps/api/`) builds, so they live here under
`docs/` rather than inside either package (and so they never touch the web
bundle-size gate).

Reference them from Markdown with a repo-relative path — e.g. from the root
README: `![Directory view](docs/images/directory.png)`.

## The screenshots are generated, not taken by hand

Every `.png` here is produced by the capture harness (N119):

```
npm run docs:screenshots
```

It drives the **real production bundle** (built and served by `vite preview`,
exactly as the e2e suite does) against network-mocked `/api/*` fixtures, and
writes the files listed below. Re-run it whenever the interface it photographs
changes; these are the manual's illustrations, and a stale illustration is a
claim the reader has no way to check.

| File | What it shows | Used by |
|---|---|---|
| `directory.png` | The Directory at desktop width | root README, USER-MANUAL §3 |
| `profile-view.png` | A brother's profile, full page | root README, USER-MANUAL §4–5 |
| `profile-edit-privacy.png` | The Privacy & consent switches while editing | USER-MANUAL §4, §8 |
| `admin.png` | The Admin page, full page | USER-MANUAL §7 |
| `directory-mobile-options.png` | The Directory on a phone, Options fold open | USER-MANUAL §3, §9 |

**The run is deterministic, with one known exception.** A fixed generator seed, a
fixed roster size, fixed viewports, animations frozen, layout settling awaited,
and the footer's build-id line hidden — so a run against an unchanged UI
reproduces the previous files byte for byte. That is the point: after a run, a
non-empty `git status` means *the interface actually moved*, rather than merely
that someone retook a picture. Don't defeat it by capturing by hand.

⚠ **The exception: `directory-mobile-options.png` differs about one run in ten.**
The two renderings are visually identical — it alternates between two byte
outputs for a cause not yet run down (OFC-284). Treat a diff on *that file alone*
with no visible change as noise and discard it; a diff on any other file, or any
visible change, is real. The other four are stable across every run measured
(10+).

**Dark mode throughout** is a deliberate aesthetic choice (Forrest's call at the
6c-2 plan gate), not a technical constraint.

## Two rules for anything added here

- **Fake data only — never real member PII.** This repository is public. The
  harness satisfies this structurally: its roster comes from `tools/fake-data`,
  whose Constitution IDs are all above the #5000 fake floor and whose emails are
  all `example.test`, and the app is driven against mocks, so it never reaches a
  real API. Anything added by some *other* route must be captured from
  **staging** (`pbe-book-staging.web.app`, fake data by design), never from
  production — confirm no real name, email, or address is visible before
  committing.
- **Optimize for the slow-connection audience.** Book's readers skew 60+ and many
  are on slow links. Compress and right-size images before committing (PNG for UI
  screenshots, sensible dimensions, run through a lossless optimizer) — keep the
  repo and any doc pages byte-frugal. The generated shots run between roughly
  45 KB and 125 KB, which is the band to stay in.
