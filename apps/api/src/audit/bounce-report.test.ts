import { describe, expect, it } from "vitest";
import type {
  GhostBounceEvent,
  GhostMemberRecord,
  GhostNewsletterEmail,
} from "../identity/ghost-reader.js";
import { type BounceReportInput, planBounceReport } from "./bounce-report.js";

/** The email-bounce report join (5b-2; D120), ported from export-bounces.js. */

const GEN = "2026-07-09T12:00:00.000Z";

const MEMBERS: GhostMemberRecord[] = [
  { id: "m1", email: "a@example.test", name: "A", subscribed: true },
  { id: "m2", email: "b@example.test", name: "B", subscribed: true },
];

function run(input: Partial<BounceReportInput>) {
  return planBounceReport({
    members: MEMBERS,
    bounceEvents: [],
    newsletterEmails: [],
    generatedAt: GEN,
    ...input,
  });
}

describe("planBounceReport", () => {
  it("aggregates per member: count, latest timestamp, and latest newsletter title", () => {
    const bounceEvents: GhostBounceEvent[] = [
      { memberId: "m1", emailId: "e1", at: "2026-01-01T00:00:00.000Z" },
      { memberId: "m1", emailId: "e2", at: "2026-06-01T00:00:00.000Z" },
    ];
    const newsletterEmails: GhostNewsletterEmail[] = [
      { emailId: "e1", title: "Spring Issue" },
      { emailId: "e2", title: "Summer Issue" },
    ];
    const report = run({ bounceEvents, newsletterEmails });
    expect(report.generatedAt).toBe(GEN);
    expect(report.rows).toEqual([
      {
        email: "a@example.test",
        bounce_count: 2,
        last_bounce_at: "2026-06-01T00:00:00.000Z",
        last_bounce_newsletter: "Summer Issue", // the most recent event's newsletter
      },
    ]);
    expect(report.skipped).toBe(0);
  });

  it("skips events for a member Ghost has hard-deleted (unresolvable id)", () => {
    const report = run({
      bounceEvents: [{ memberId: "ghost-deleted", emailId: "e1", at: "2026-06-01T00:00:00.000Z" }],
    });
    expect(report.rows).toEqual([]);
    expect(report.skipped).toBe(1);
  });

  it("falls back to the raw email id when no title is known", () => {
    const report = run({
      bounceEvents: [{ memberId: "m1", emailId: "e9", at: "2026-06-01T00:00:00.000Z" }],
      newsletterEmails: [],
    });
    expect(report.rows[0]?.last_bounce_newsletter).toBe("(unknown newsletter e9)");
  });

  it("sorts most-bounces-first, then most-recent, then email A–Z", () => {
    const report = run({
      bounceEvents: [
        { memberId: "m2", emailId: "e1", at: "2026-05-01T00:00:00.000Z" },
        { memberId: "m1", emailId: "e1", at: "2026-01-01T00:00:00.000Z" },
        { memberId: "m1", emailId: "e2", at: "2026-02-01T00:00:00.000Z" },
      ],
    });
    // m1 bounced twice → first; m2 once → second.
    expect(report.rows.map((r) => r.email)).toEqual(["a@example.test", "b@example.test"]);
  });
});
