import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type HostingRelease,
  MAINTENANCE_PAGE_MARKER,
  MAINTENANCE_RELEASE_MESSAGE,
  isMaintenancePage,
  planBegin,
  planEnd,
  versionId,
} from "./maintenance.js";

const repoPath = (relative: string): string =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url));

const release = (
  releaseTime: string,
  version: string | null,
  message?: string,
  type = "DEPLOY",
): HostingRelease => ({
  releaseTime,
  type,
  ...(message === undefined ? {} : { message }),
  ...(version === null
    ? {}
    : { version: { name: `sites/s/versions/${version}`, status: "FINALIZED" } }),
});

const RELEASED = release("2026-10-02T22:52:40Z", "released");
const OLDER = release("2026-10-01T21:16:56Z", "older");
const MAINT = release("2026-10-03T18:00:00Z", "maint", MAINTENANCE_RELEASE_MESSAGE);

describe("planBegin", () => {
  it("records the live version when Book is serving normally", () => {
    expect(planBegin([OLDER, RELEASED])).toEqual({
      ok: true,
      liveVersion: "sites/s/versions/released",
      liveReleasedAt: RELEASED.releaseTime,
    });
  });

  it("refuses a second begin, which would make the maintenance page the version end restores", () => {
    const decision = planBegin([MAINT, RELEASED]);
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.reason).toMatch(/already in maintenance/);
  });

  it("refuses when there is nothing to come back to", () => {
    expect(planBegin([]).ok).toBe(false);
    expect(planBegin([release("2026-10-03T00:00:00Z", null, undefined, "SITE_DISABLE")]).ok).toBe(
      false,
    );
  });
});

describe("planEnd", () => {
  it("restores exactly the version that was live before maintenance began", () => {
    expect(planEnd([MAINT, RELEASED, OLDER])).toEqual({
      ok: true,
      maintenanceVersion: "sites/s/versions/maint",
      restoreVersion: "sites/s/versions/released",
      restoreReleasedAt: RELEASED.releaseTime,
    });
  });

  it("does not trust the API's list order — it sorts by release time", () => {
    const decision = planEnd([OLDER, RELEASED, MAINT]);
    expect(decision.ok && decision.restoreVersion).toBe("sites/s/versions/released");
  });

  it("refuses — and so never rolls back — when a deploy has already ended maintenance", () => {
    // begin, then a release (or a staging merge) deployed the real site on top.
    const newRelease = release("2026-10-03T19:00:00Z", "new-release");
    const decision = planEnd([newRelease, MAINT, RELEASED]);
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.reason).toMatch(/not in maintenance.*roll it back/s);
  });

  it("refuses when Book was never in maintenance", () => {
    expect(planEnd([RELEASED, OLDER]).ok).toBe(false);
  });

  it("refuses two maintenance releases in a row rather than guessing", () => {
    const earlierMaint = release("2026-10-03T17:00:00Z", "maint0", MAINTENANCE_RELEASE_MESSAGE);
    const decision = planEnd([MAINT, earlierMaint, RELEASED]);
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.reason).toMatch(/ALSO a maintenance release/);
  });

  it("refuses when there is no usable earlier version", () => {
    expect(planEnd([MAINT]).ok).toBe(false);
    expect(
      planEnd([MAINT, release("2026-10-02T00:00:00Z", null, undefined, "SITE_DISABLE")]).ok,
    ).toBe(false);
    const unfinished: HostingRelease = {
      releaseTime: "2026-10-02T00:00:00Z",
      version: { name: "sites/s/versions/x", status: "CREATED" },
    };
    expect(planEnd([MAINT, unfinished]).ok).toBe(false);
  });
});

it("versionId strips the resource path", () => {
  expect(versionId("sites/pbe-book-staging/versions/50711625df1b5864")).toBe("50711625df1b5864");
});

/**
 * The OFC-334 guard. Firebase Hosting serves a matching STATIC FILE in preference
 * to a rewrite (measured on staging in the 7b-3 live test — not documented), so the
 * maintenance config used to cover every path EXCEPT the ones a fresh visitor
 * arrives on: `/` and `/index.html` still served the real SPA from `apps/web/dist`.
 * The rewrite can only win everywhere if the public directory holds nothing but the
 * maintenance page. These assertions fail if anyone points it back at a build.
 */
describe("firebase.maintenance.json cannot serve the SPA shell (OFC-334)", () => {
  const config = JSON.parse(readFileSync(repoPath("firebase.maintenance.json"), "utf8")) as {
    hosting: {
      public: string;
      rewrites: { source: string; destination?: string; run?: unknown }[];
    };
  };

  it("publishes a directory containing ONLY maintenance.html", () => {
    expect(config.hosting.public).not.toMatch(/apps\/web/);
    expect(readdirSync(repoPath(config.hosting.public))).toEqual(["maintenance.html"]);
  });

  it("rewrites every path to the maintenance page and never reaches Cloud Run", () => {
    expect(config.hosting.rewrites).toEqual([{ source: "**", destination: "/maintenance.html" }]);
  });

  it("serves a self-contained page that carries the marker the operator tools probe for", () => {
    const page = readFileSync(repoPath(`${config.hosting.public}/maintenance.html`), "utf8");
    expect(isMaintenancePage(page)).toBe(true);
    // D118: served from the edge while the backend is down — no scripts, no external
    // stylesheets, fonts or images (the CSP in the config forbids them anyway).
    expect(page).not.toMatch(/<script|<link|<img|\bsrc=|url\(/i);
  });

  it("agrees with the marker the restore and bulk-headshot pre-flights use", () => {
    const support = readFileSync(repoPath("apps/api/src/tools/restore-support.ts"), "utf8");
    expect(support).toContain(`export const MAINTENANCE_MARKER = "${MAINTENANCE_PAGE_MARKER}";`);
  });
});
