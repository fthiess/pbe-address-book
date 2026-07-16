import { getHelpEntry } from "@pbe/help-content";
import type { AdminBugReport } from "@pbe/shared";
import { useEffect, useMemo, useState } from "react";
import { deleteBugReport, fetchBugReports, markBugReportsReviewed } from "../../lib/api.js";
import { AdminCard, BugIcon } from "./AdminCard.js";
import { formatForCopy, formatTimestamp } from "./bugReportFormat.js";

type Filter = "new" | "reviewed" | "all";
type LoadState = "loading" | "ready" | "error";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "new", label: "New" },
  { key: "reviewed", label: "Reviewed" },
  { key: "all", label: "All" },
];

/**
 * The bug-report review queue (PRD §5.8; D121) — the real surface that replaces the
 * 5a-1 placeholder. **Book is a triage-and-clear tool, not a bug tracker:** an admin
 * reads reports here, copies any worth keeping into their external tracker, and
 * deletes them. `new`/`reviewed` is an unread marker — reports load, and the ones
 * that were `new` are marked reviewed server-side so they read as unread on this
 * visit and quiet on the next.
 */
export function BugReportsCard() {
  const help = getHelpEntry("admin.bugReports");
  const [reports, setReports] = useState<AdminBugReport[]>([]);
  const [load, setLoad] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<Filter>("new");

  // A one-shot load on mount (empty deps): fetch the queue, then fire the
  // best-effort mark-reviewed for the reports that were unread.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const fetched = await fetchBugReports(controller.signal);
        if (cancelled) {
          return;
        }
        setReports(fetched);
        setLoad("ready");
        // Mark the ones that were unread as reviewed for the NEXT visit — best-effort,
        // and deliberately WITHOUT mutating the local statuses, so their NEW badges
        // still show on this visit (the unread-email model).
        const unread = fetched.filter((r) => r.status === "new").map((r) => r.id);
        void markBugReportsReviewed(unread);
      } catch {
        if (!cancelled) {
          setLoad("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const counts = useMemo(() => {
    let newCount = 0;
    for (const r of reports) {
      if (r.status === "new") newCount += 1;
    }
    return { new: newCount, reviewed: reports.length - newCount, all: reports.length };
  }, [reports]);

  const visible = useMemo(
    () => (filter === "all" ? reports : reports.filter((r) => r.status === filter)),
    [reports, filter],
  );

  const onDelete = async (id: string) => {
    const removed = reports.find((r) => r.id === id);
    // Optimistic: drop it immediately via a functional update (so a concurrent
    // delete of another row isn't clobbered).
    setReports((rs) => rs.filter((r) => r.id !== id));
    try {
      await deleteBugReport(id);
    } catch {
      // Re-insert only THIS report (not a stale whole-list snapshot, which could
      // resurrect a row a concurrent delete already removed), keeping newest-first.
      if (removed) {
        setReports((rs) =>
          [...rs, removed].sort((a, b) =>
            a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0,
          ),
        );
      }
    }
  };

  return (
    <AdminCard
      icon={<BugIcon />}
      title={help?.label ?? "Bug reports"}
      badge={counts.new > 0 ? <NewCountBadge count={counts.new} /> : undefined}
      description={help?.helperText}
    >
      {load === "loading" && (
        <output className="mt-4 block text-[length:var(--text-body-sm)] text-muted-foreground">
          Loading reports…
        </output>
      )}
      {load === "error" && (
        <p role="alert" className="mt-4 text-[length:var(--text-body-sm)] text-destructive">
          Couldn't load bug reports. Please reload the page to try again.
        </p>
      )}
      {load === "ready" && (
        <div className="mt-4">
          <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
            <legend className="sr-only">Filter reports</legend>
            {FILTERS.map(({ key, label }) => {
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(key)}
                  className={`inline-flex min-h-9 items-center rounded-[var(--radius-md)] px-3 text-[length:var(--text-label)] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "border border-input bg-card hover:bg-accent"
                  }`}
                >
                  {label} ({counts[key]})
                </button>
              );
            })}
          </fieldset>

          {visible.length === 0 ? (
            <p className="mt-4 text-[length:var(--text-body-sm)] text-muted-foreground">
              {reports.length === 0
                ? "No bug reports. When a member files one, it will appear here."
                : filter === "new"
                  ? "No new reports."
                  : "No reports to show."}
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {visible.map((report) => (
                <BugReportRow key={report.id} report={report} onDelete={onDelete} />
              ))}
            </ul>
          )}
        </div>
      )}
    </AdminCard>
  );
}

function NewCountBadge({ count }: { count: number }) {
  return (
    <span className="rounded-[var(--radius-pill)] bg-primary px-2.5 py-0.5 text-[length:var(--text-caption)] font-semibold text-primary-foreground">
      {count} new
    </span>
  );
}

function BugReportRow({
  report,
  onDelete,
}: {
  report: AdminBugReport;
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatForCopy(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — leave the button unchanged.
    }
  };

  return (
    <li className="rounded-[var(--radius-lg)] border border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{report.submitterName}</span>
        <span className="text-[length:var(--text-caption)] text-muted-foreground">
          #{report.submitterId}
        </span>
        {report.status === "new" && (
          <span className="rounded-[var(--radius-pill)] bg-primary px-2 py-0.5 text-[length:var(--text-caption)] font-bold text-primary-foreground">
            NEW
          </span>
        )}
      </div>
      <p className="mt-1 text-[length:var(--text-caption)] text-muted-foreground">
        {formatTimestamp(report.submittedAt)} · {report.page || "(unknown page)"}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-[length:var(--text-body-sm)] leading-relaxed">
        {report.description}
      </p>
      <ReportContext report={report} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex min-h-9 items-center rounded-[var(--radius-md)] border border-input bg-card px-3 text-[length:var(--text-label)] font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? "Copied" : "Copy report"}
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => onDelete(report.id)}
              className="inline-flex min-h-9 items-center rounded-[var(--radius-md)] bg-destructive px-3 text-[length:var(--text-label)] font-semibold text-destructive-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-9 items-center rounded-[var(--radius-md)] px-3 text-[length:var(--text-label)] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-9 items-center rounded-[var(--radius-md)] border border-input bg-card px-3 text-[length:var(--text-label)] font-semibold text-destructive outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

/** The captured technical context, in a collapsed `<details>` so it doesn't crowd the row. */
function ReportContext({ report }: { report: AdminBugReport }) {
  const ctx = report.clientContext;
  // Ordered label/value rows; a row is dropped when its value is absent (the
  // browser wouldn't report it). User agent is last — it's the long raw fallback.
  const rows: { label: string; value: string | undefined }[] = [
    { label: "URL", value: report.url },
    { label: "Device", value: ctx?.device },
    { label: "OS", value: ctx?.os },
    { label: "Browser", value: ctx?.browser },
    { label: "Network", value: ctx?.network },
    { label: "Viewport", value: ctx?.viewport },
    { label: "Web version", value: ctx?.webVersion },
    { label: "API version", value: report.apiVersion },
    { label: "User agent", value: ctx?.userAgent },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));

  if (rows.length === 0) {
    return null;
  }
  return (
    <details className="mt-2 text-[length:var(--text-caption)] text-muted-foreground">
      <summary className="cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Technical details
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 break-all">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="font-medium">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
