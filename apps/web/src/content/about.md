<!--
  The About page's copy (OFC-244, N116). This file is the source: it is compiled to
  HTML at **build time** by `aboutHtmlPlugin` in apps/web/vite.config.ts, so no
  Markdown parser ships in the SPA bundle.

  Two rules the compiler enforces, so a violation fails the build rather than
  reaching a reader:

  1. **Start headings at `##`.** AboutPage.tsx renders the page's single `<h1>`;
     a `#` here would break heading order (WCAG 1.3.1 / axe `heading-order`).
  2. **No raw HTML, no external images or embeds.** The compiled HTML is injected
     with `dangerouslySetInnerHTML`, and Firebase Hosting's CSP is `default-src
     'self'` — an external asset would pass local e2e (vite preview sends no CSP)
     and fail on staging.

  Copy convention (N116): "PBE Address Book" on first use, "the Address Book"
  thereafter. Never bare "Book" — that is internal shorthand only.
-->

## What this is

The PBE Address Book is a private directory for the brothers of Phi Beta Epsilon. It lets you
look up any brother's contact information and keep your own current. Only brothers can sign in,
and the Address Book shows brothers only what each brother has chosen to share.

## Something not right? Tell us

If anything doesn't work, doesn't look right, or is simply hard to read, use the **Report a
bug** link at the top of any page. That's also the place for feature requests and suggestions.

Reports go to the brothers who run the Address Book, who read them here in the app. Nothing is
emailed to anyone.

## Open source

The Address Book's code is open source under the MIT License, and it lives on GitHub at
[github.com/fthiess/pbe-address-book](https://github.com/fthiess/pbe-address-book) — you're
welcome to look.

PBE's names and artwork are a separate matter: "Phi Beta Epsilon", "PBE", the crest, the
triangle device, and the other brand assets are reserved by the Phi Beta Epsilon Corporation
and are **not** covered by that license. The details are in
[TRADEMARKS.md](https://github.com/fthiess/pbe-address-book/blob/main/TRADEMARKS.md); the code
license is in [LICENSE](https://github.com/fthiess/pbe-address-book/blob/main/LICENSE).

## Privacy

Your profile page in this Address Book has settings you can change that control what
information about yourself will be shared with other brothers. You can change these
settings at any time on [your own profile](/brother/me/edit) — or reach it by clicking your
name at the top right of the screen and selecting "My profile". Please be
aware that Address
Book staff may be able to see information you have marked as private because of their
responsibilities to maintain and manage Address Book data and operations.

The MIT Alumni Association maintains [their own alumni database](https://alum.mit.edu/) and
occasionally provides us with updates of contact information for brothers. While we do not
do so today, we might in the future return the favor and provide updates of your contact
details to them, if your privacy settings give us permission to do so.

To help understand what features are useful to our brothers, the PBE Address Book uses a
standard analytics tool ([Mixpanel](https://mixpanel.com/)) to track usage and page views. We
use this strictly to improve this site; we don't run ads, and we will never sell, share, or
monetize any analytics data with any third party, including MIT.