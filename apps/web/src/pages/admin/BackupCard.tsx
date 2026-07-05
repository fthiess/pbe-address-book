import { getHelpEntry } from "@pbe/help-content";
import { useState } from "react";
import { downloadBackup } from "../../lib/api.js";
import { ADMIN_BTN_SECONDARY, AdminCard, DownloadIcon } from "./AdminCard.js";

/**
 * The Download-backup control (PRD §5.8.1; D63). Fetches the JSON snapshot and
 * saves it to the admin's disk; the admin is the custodian of the archive (D101).
 * The image-bundle zip and the nightly automated job are Phase 7 (the description
 * says so honestly rather than showing a fictional "last backup" timestamp).
 */
export function BackupCard() {
  const help = getHelpEntry("admin.backup");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");

  const onDownload = async () => {
    setStatus("working");
    try {
      await downloadBackup();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  return (
    <AdminCard
      icon={<DownloadIcon />}
      title={help?.label ?? "Download backup"}
      description={help?.helperText}
      action={
        <button
          type="button"
          onClick={onDownload}
          disabled={status === "working"}
          className={ADMIN_BTN_SECONDARY}
        >
          <DownloadIcon />
          {status === "working" ? "Preparing…" : "Download now"}
        </button>
      }
    >
      {status === "done" && (
        <output className="mt-4 block text-[length:var(--text-body-sm)] text-primary">
          Your backup has downloaded. Keep it somewhere safe.
        </output>
      )}
      {status === "error" && (
        <p role="alert" className="mt-4 text-[length:var(--text-body-sm)] text-destructive">
          Something went wrong preparing the backup. Please try again.
        </p>
      )}
    </AdminCard>
  );
}
