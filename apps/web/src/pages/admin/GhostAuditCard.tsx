import { getHelpEntry } from "@pbe/help-content";
import { useState } from "react";
import { ApiError, fetchGhostAudit } from "../../lib/api.js";
import { saveBlob } from "../../lib/utils.js";
import { ADMIN_BTN_SECONDARY, AdminCard, SyncIcon } from "./AdminCard.js";
import { formatAuditReportMarkdown } from "./ghostAuditFormat.js";

/**
 * The Book/Ghost alignment audit control (PRD §5.8.3; D55/D99). Runs the audit and
 * **downloads the report as Markdown** — deliberately no in-UI table (the 5b-2
 * decision): the audit is heterogeneous and periodic, better read in a file. The
 * audit is read-only into Book (the 5b-2 amendment to D103) — the description says
 * so, so an admin knows it changes nothing and each difference is resolved by hand.
 */
export function GhostAuditCard() {
  const help = getHelpEntry("admin.ghostAudit");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error" | "unconfigured">(
    "idle",
  );
  const [count, setCount] = useState(0);

  const onRun = async () => {
    setStatus("working");
    try {
      const report = await fetchGhostAudit();
      const markdown = formatAuditReportMarkdown(report);
      const date = report.generatedAt.slice(0, 10);
      saveBlob(
        new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        `book-ghost-audit-${date}.md`,
      );
      setCount(report.discrepancies.length);
      setStatus("done");
    } catch (error) {
      // 503 = Ghost not configured (a calm, distinct message, not a scary error).
      setStatus(error instanceof ApiError && error.status === 503 ? "unconfigured" : "error");
    }
  };

  return (
    <AdminCard
      icon={<SyncIcon />}
      title={help?.label ?? "Book / Ghost alignment audit"}
      description={help?.helperText}
      action={
        <button
          type="button"
          onClick={onRun}
          disabled={status === "working"}
          className={ADMIN_BTN_SECONDARY}
        >
          <SyncIcon />
          {status === "working" ? "Running…" : "Run audit"}
        </button>
      }
    >
      {status === "done" && (
        <output className="mt-4 block text-[length:var(--text-body-sm)] text-primary">
          {count === 0
            ? "Audit complete — no differences found. Book and Ghost are aligned."
            : `Audit complete — the report has downloaded (${count} difference${
                count === 1 ? "" : "s"
              } to review).`}
        </output>
      )}
      {status === "unconfigured" && (
        <p className="mt-4 text-[length:var(--text-body-sm)] text-muted-foreground">
          The Ghost connection isn't configured in this environment, so there's nothing to audit
          here.
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="mt-4 text-[length:var(--text-body-sm)] text-destructive">
          Something went wrong running the audit. Please try again.
        </p>
      )}
    </AdminCard>
  );
}
