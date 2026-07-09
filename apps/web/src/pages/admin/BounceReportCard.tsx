import { useState } from "react";
import { ApiError, fetchBounceReport } from "../../lib/api.js";
import { saveBlob } from "../../lib/utils.js";
import { ADMIN_BTN_SECONDARY, AdminCard, MailWarningIcon } from "./AdminCard.js";
import { formatBounceReportCsv } from "./bounceReportFormat.js";

/**
 * The email-bounce report control (D120). Runs the report and **downloads a CSV**
 * for the admin's spreadsheet — a separate job from the alignment audit (email-
 * address maintenance, not drift), so its own button, and deliberately not rendered
 * in the UI (D120: no per-user banner, no directory/profile indicator, no panel).
 */
export function BounceReportCard() {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error" | "unconfigured">(
    "idle",
  );
  const [count, setCount] = useState(0);
  const [skipped, setSkipped] = useState(0);

  const onRun = async () => {
    setStatus("working");
    try {
      const report = await fetchBounceReport();
      const csv = formatBounceReportCsv(report);
      const date = report.generatedAt.slice(0, 10);
      // UTF-8 BOM so Excel reads accented names/subjects correctly.
      saveBlob(
        new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }),
        `book-bounce-report-${date}.csv`,
      );
      setCount(report.rows.length);
      setSkipped(report.skipped);
      setStatus("done");
    } catch (error) {
      setStatus(error instanceof ApiError && error.status === 503 ? "unconfigured" : "error");
    }
  };

  // A trailing note whenever bounce events were dropped because their member is no
  // longer in Ghost — so a header-only CSV is never read as a clean "no bounces".
  const skippedNote =
    skipped > 0
      ? ` ${skipped} event${skipped === 1 ? "" : "s"} skipped (the bouncing member is no longer in Ghost).`
      : "";

  return (
    <AdminCard
      icon={<MailWarningIcon />}
      title="Email bounce report"
      description="Downloads a spreadsheet (CSV) of brothers whose PBE News emails have bounced, so their addresses can be checked and updated."
      action={
        <button
          type="button"
          onClick={onRun}
          disabled={status === "working"}
          className={ADMIN_BTN_SECONDARY}
        >
          <MailWarningIcon />
          {status === "working" ? "Preparing…" : "Download report"}
        </button>
      }
    >
      {status === "done" && (
        <output className="mt-4 block text-[length:var(--text-body-sm)] text-primary">
          {count === 0
            ? `Report complete — no current bouncing addresses.${skippedNote}`
            : `Report complete — the CSV has downloaded (${count} bouncing address${
                count === 1 ? "" : "es"
              }).${skippedNote}`}
        </output>
      )}
      {status === "unconfigured" && (
        <p className="mt-4 text-[length:var(--text-body-sm)] text-muted-foreground">
          The Ghost connection isn't configured in this environment, so there's no bounce data to
          report here.
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="mt-4 text-[length:var(--text-body-sm)] text-destructive">
          Something went wrong preparing the bounce report. Please try again.
        </p>
      )}
    </AdminCard>
  );
}
