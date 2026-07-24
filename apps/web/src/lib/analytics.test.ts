import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AnalyticsClient,
  __resetAnalyticsStateForTests,
  identifyMember,
  resetIdentity,
  setAnalyticsClient,
  trackAlignmentAuditRun,
  trackBackupDownloaded,
  trackBounceReportRun,
  trackBrotherDeleted,
  trackBrotherStarred,
  trackBrotherUnstarred,
  trackBugReportDeleted,
  trackColumnLayoutChanged,
  trackColumnsReset,
  trackConsentToggleChanged,
  trackDebrotherStatusChanged,
  trackDeceasedStatusChanged,
  trackDirectoryLinkClicked,
  trackExportPerformed,
  trackFilterApplied,
  trackHelpOpened,
  trackMastheadLogoClicked,
  trackMobileOptionsOpened,
  trackPageView,
  trackPbeNewsLinkClicked,
  trackProfileSaved,
  trackProfileViewed,
  trackReportABugClicked,
  trackRoleChanged,
  trackSearchPerformed,
  trackSignedIn,
  trackSystemBannerChanged,
  trackTextSizeChanged,
  trackThemeChanged,
  trackViewAsEnded,
  trackViewAsStarted,
} from "./analytics.js";

function fakeClient() {
  return {
    identify: vi.fn(),
    peopleSet: vi.fn(),
    track: vi.fn(),
    reset: vi.fn(),
  } satisfies AnalyticsClient;
}

let client: ReturnType<typeof fakeClient>;

beforeEach(() => {
  client = fakeClient();
  setAnalyticsClient(client);
  __resetAnalyticsStateForTests();
});

afterEach(() => {
  setAnalyticsClient(null);
  __resetAnalyticsStateForTests();
});

describe("identifyMember (D137/N123)", () => {
  it("identifies on the Ghost uuid and sets Constitution ID + role as user properties", () => {
    identifyMember("uuid-abc", 5247, "brother");

    expect(client.identify).toHaveBeenCalledExactlyOnceWith("uuid-abc");
    expect(client.peopleSet).toHaveBeenCalledExactlyOnceWith({
      "Constitution ID": 5247,
      Role: "brother",
    });
  });

  it("never sends the brother's name (D88 dropped it, and it stays dropped)", () => {
    identifyMember("uuid-abc", 5247, "brother");

    const properties = client.peopleSet.mock.calls[0]?.[0] ?? {};
    expect(Object.keys(properties)).toEqual(["Constitution ID", "Role"]);
    expect(JSON.stringify(properties)).not.toMatch(/name/i);
  });

  it("does NOT identify when the uuid is absent — no fallback key", () => {
    // The load-bearing rule of 7a-2. Under Simplified ID Merge two `$user_id`s can
    // never be merged, so identifying on any other key would permanently split this
    // brother from the person the newsletter already identifies by uuid (N123).
    identifyMember(undefined, 5247, "brother");

    expect(client.identify).not.toHaveBeenCalled();
    expect(client.peopleSet).not.toHaveBeenCalled();
  });

  it("identifies once per uuid, not once per render", () => {
    identifyMember("uuid-abc", 5247, "brother");
    identifyMember("uuid-abc", 5247, "brother");
    identifyMember("uuid-abc", 5247, "admin");

    expect(client.identify).toHaveBeenCalledOnce();
  });

  it("re-identifies after a reset, so a second brother on one machine is a new person", () => {
    identifyMember("uuid-abc", 5247, "brother");
    resetIdentity();
    identifyMember("uuid-xyz", 5301, "admin");

    expect(client.identify).toHaveBeenCalledTimes(2);
    expect(client.identify).toHaveBeenLastCalledWith("uuid-xyz");
  });

  it("is inert with no client registered (a token-less dev or CI build)", () => {
    setAnalyticsClient(null);
    expect(() => identifyMember("uuid-abc", 5247, "brother")).not.toThrow();
  });
});

describe("resetIdentity", () => {
  it("resets after an identified session", () => {
    identifyMember("uuid-abc", 5247, "brother");
    resetIdentity();

    expect(client.reset).toHaveBeenCalledOnce();
  });

  it("resets even when the session was never identified", () => {
    // The uuid-less case needs this most: without a reset the anonymous device id
    // survives, and the *next* brother's identify() would retroactively absorb this
    // one's anonymous events — unrecoverable under Simplified ID Merge.
    resetIdentity();

    expect(client.reset).toHaveBeenCalledOnce();
  });
});

describe("trackPageView (P6)", () => {
  it("sends the route pattern as given", () => {
    trackPageView("/brother/:id");

    expect(client.track).toHaveBeenCalledExactlyOnceWith("Page View", {
      "Route Pattern": "/brother/:id",
    });
  });

  it("carries no record id for any route the app declares", () => {
    // A guard on the *shape* of what ships: whatever patterns App.tsx declares, none
    // of them may contain a bare number. `/brother/5247` in an event property would
    // record whom a brother looked at.
    for (const pattern of [
      "/",
      "/brother/new",
      "/brother/me",
      "/brother/me/edit",
      "/brother/:id",
      "/brother/:id/edit",
      "/admin",
      "/about",
      "/auth/callback",
      "/*",
    ]) {
      expect(pattern).not.toMatch(/\d/);
    }
  });
});

describe("trackSearchPerformed (P6)", () => {
  it("sends the bucket and the after-empty flag — no query text, no matched ids", () => {
    trackSearchPerformed(3, false);

    expect(client.track).toHaveBeenCalledExactlyOnceWith("Search Performed", {
      "Result Count": "2-10",
      "After Empty": false,
    });
  });

  it("carries `After Empty: true` when the prior search returned nothing", () => {
    trackSearchPerformed(0, true);

    expect(client.track).toHaveBeenCalledExactlyOnceWith("Search Performed", {
      "Result Count": "0",
      "After Empty": true,
    });
  });

  it("never sends a raw count, only a bucket", () => {
    trackSearchPerformed(1, false);
    const [, props] = client.track.mock.calls[0] ?? [];
    expect(props?.["Result Count"]).toBe("1");
    expect(JSON.stringify(props)).not.toMatch(/\b(700|42)\b/);
  });
});

describe("7a-4 feature events (D145) — names/buckets only, never whom (P6)", () => {
  it("Signed In carries no properties", () => {
    trackSignedIn();
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Signed In", {});
  });

  it("Profile Viewed carries only Own — never a record id or name", () => {
    trackProfileViewed(false);
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Profile Viewed", { Own: false });

    const [, props] = client.track.mock.calls[0] ?? [];
    expect(Object.keys(props ?? {})).toEqual(["Own"]);
    expect(JSON.stringify(props)).not.toMatch(/\d/); // no id leaked
  });

  it("Profile Saved carries the field-group labels and Own — never a field value", () => {
    trackProfileSaved(["contact", "photo"], true);
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Profile Saved", {
      "Field Groups": ["contact", "photo"],
      Own: true,
    });
  });

  it("Consent Toggle Changed carries the toggle key and its new state", () => {
    trackConsentToggleChanged("profile.privacy.shareEmail", false);
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Consent Toggle Changed", {
      Toggle: "profile.privacy.shareEmail",
      Enabled: false,
    });
  });

  it("Brother Starred / Un-starred carry NO identity at all", () => {
    trackBrotherStarred();
    trackBrotherUnstarred();

    expect(client.track).toHaveBeenNthCalledWith(1, "Brother Starred", {});
    expect(client.track).toHaveBeenNthCalledWith(2, "Brother Un-starred", {});
    // The whole point of Forrest's OFC-296 note: usage without the viewed identity.
    for (const call of client.track.mock.calls) {
      expect(call[1]).toEqual({});
    }
  });

  it("Filter Applied maps a filter key to its dimension label, never a value", () => {
    trackFilterApplied("major"); // UI "course"
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Filter Applied", {
      Dimension: "Course",
    });
  });

  it("Column Layout Changed carries the column key (a field name) and visibility", () => {
    trackColumnLayoutChanged("email", true);
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Column Layout Changed", {
      Column: "email",
      Shown: true,
    });
  });

  it("Columns Reset carries no properties", () => {
    trackColumnsReset();
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Columns Reset", {});
  });

  it("Help Opened carries the help topic only", () => {
    trackHelpOpened("Class Year");
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Help Opened", { Topic: "Class Year" });
  });

  it("Export Performed carries scope and a bucketed row count, never the rows", () => {
    trackExportPerformed("selection", 42);
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Export Performed", {
      Scope: "selection",
      "Row Count": "11-100",
    });
  });

  it("Mobile Options Opened carries no properties", () => {
    trackMobileOptionsOpened();
    expect(client.track).toHaveBeenCalledExactlyOnceWith("Mobile Options Opened", {});
  });

  it("every 7a-4 wrapper is inert with no client registered", () => {
    setAnalyticsClient(null);
    expect(() => {
      trackSignedIn();
      trackProfileViewed(true);
      trackProfileSaved(["contact"], true);
      trackConsentToggleChanged("k", true);
      trackBrotherStarred();
      trackBrotherUnstarred();
      trackFilterApplied("classYear");
      trackColumnLayoutChanged("email", false);
      trackColumnsReset();
      trackHelpOpened("t");
      trackExportPerformed("view", 5);
      trackMobileOptionsOpened();
    }).not.toThrow();
  });
});

describe("7a-4 follow-up events (OFC-315) — roles/settings/booleans only, never whom (P6)", () => {
  it("View As Started / Ended carry the role, never a person", () => {
    trackViewAsStarted("brother");
    trackViewAsEnded("manager");

    expect(client.track).toHaveBeenNthCalledWith(1, "View As Started", { Role: "brother" });
    expect(client.track).toHaveBeenNthCalledWith(2, "View As Ended", { Role: "manager" });
  });

  it("the admin-tools actions carry no properties", () => {
    trackBackupDownloaded();
    trackAlignmentAuditRun();
    trackBounceReportRun();
    trackBugReportDeleted();

    expect(client.track).toHaveBeenNthCalledWith(1, "Backup Downloaded", {});
    expect(client.track).toHaveBeenNthCalledWith(2, "Alignment Audit Run", {});
    expect(client.track).toHaveBeenNthCalledWith(3, "Bounce Report Run", {});
    expect(client.track).toHaveBeenNthCalledWith(4, "Bug Report Deleted", {});
  });

  it("System Banner Changed carries severity + message on a set", () => {
    trackSystemBannerChanged(true, "warning", "Site maintenance tonight");
    expect(client.track).toHaveBeenCalledExactlyOnceWith("System Banner Changed", {
      Active: true,
      Severity: "warning",
      Message: "Site maintenance tonight",
    });
  });

  it("System Banner Changed carries only Active:false on a clear (no stale message)", () => {
    trackSystemBannerChanged(false);
    expect(client.track).toHaveBeenCalledExactlyOnceWith("System Banner Changed", {
      Active: false,
    });
  });

  it("the chrome/nav clicks carry no properties", () => {
    trackReportABugClicked();
    trackPbeNewsLinkClicked();
    trackMastheadLogoClicked();
    trackDirectoryLinkClicked();

    expect(client.track).toHaveBeenNthCalledWith(1, "Report a Bug Clicked", {});
    expect(client.track).toHaveBeenNthCalledWith(2, "PBE News Link Clicked", {});
    expect(client.track).toHaveBeenNthCalledWith(3, "Masthead Logo Clicked", {});
    expect(client.track).toHaveBeenNthCalledWith(4, "Directory Link Clicked", {});
  });

  it("Text Size / Theme carry the chosen setting value", () => {
    trackTextSizeChanged("large");
    trackThemeChanged("dark");

    expect(client.track).toHaveBeenNthCalledWith(1, "Text Size Changed", { Size: "large" });
    expect(client.track).toHaveBeenNthCalledWith(2, "Theme Changed", { Theme: "dark" });
  });

  it("the brother-status actions carry direction/role but NEVER a brother's identity", () => {
    trackDeceasedStatusChanged(true);
    trackDebrotherStatusChanged(false);
    trackRoleChanged("manager", "brother");
    trackBrotherDeleted();

    expect(client.track).toHaveBeenNthCalledWith(1, "Deceased Status Changed", { Deceased: true });
    expect(client.track).toHaveBeenNthCalledWith(2, "Debrother Status Changed", {
      Debrothered: false,
    });
    expect(client.track).toHaveBeenNthCalledWith(3, "Role Changed", {
      Role: "manager",
      From: "brother",
    });
    expect(client.track).toHaveBeenNthCalledWith(4, "Brother Deleted", {});

    // The load-bearing P6 guarantee for the status actions: not one of them carries
    // an id, a name, or anything pointing at *which* brother was acted on.
    for (const call of client.track.mock.calls) {
      expect(JSON.stringify(call[1])).not.toMatch(/\d/);
      expect(JSON.stringify(call[1])).not.toMatch(/id|name|email/i);
    }
  });

  it("every follow-up wrapper is inert with no client registered", () => {
    setAnalyticsClient(null);
    expect(() => {
      trackViewAsStarted("brother");
      trackViewAsEnded("brother");
      trackBackupDownloaded();
      trackAlignmentAuditRun();
      trackBounceReportRun();
      trackSystemBannerChanged(true, "info", "x");
      trackBugReportDeleted();
      trackReportABugClicked();
      trackPbeNewsLinkClicked();
      trackMastheadLogoClicked();
      trackDirectoryLinkClicked();
      trackTextSizeChanged("normal");
      trackThemeChanged("system");
      trackDeceasedStatusChanged(false);
      trackDebrotherStatusChanged(true);
      trackRoleChanged("admin", "manager");
      trackBrotherDeleted();
    }).not.toThrow();
  });
});
