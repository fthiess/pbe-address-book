import type { BugReport } from "@pbe/shared";
import type { Firestore } from "firebase-admin/firestore";

const COLLECTION = "bugReports";

/**
 * The bug-report persistence seam (D121; DATABASE-SCHEMA §6.4). Injected (not a
 * direct Firestore dependency) so the bug-report routes are unit-testable against
 * an in-memory double, mirroring {@link BannerStore}/{@link BackupSource}.
 *
 * **Book is a triage-and-clear surface, not a bug tracker** — the store supports
 * exactly what an admin needs: file a report, list them newest-first, mark the
 * ones just seen as `reviewed` (the unread marker), and delete. There is no
 * update-in-place beyond the one-way status flip, and no query surface beyond the
 * whole (small) list.
 */
export interface BugReportStore {
  /** Persist a new report (status `new`); returns it with the server-assigned id. */
  create(report: Omit<BugReport, "id">): Promise<BugReport>;
  /** Every report, newest first. The volume is small, so this is unpaginated. */
  list(): Promise<BugReport[]>;
  /**
   * Flip the given reports from `new` to `reviewed` (the one-way unread marker).
   * Ignores unknown ids and already-`reviewed` ids; returns the count actually
   * transitioned so the caller can audit/report a truthful number.
   */
  markReviewed(ids: readonly string[]): Promise<number>;
  /** Delete a report — the terminal act. Idempotent (deleting an absent id is a no-op). */
  delete(id: string): Promise<void>;
}

/** The real {@link BugReportStore}: the `bugReports` collection over Firestore. */
export class FirestoreBugReportStore implements BugReportStore {
  constructor(private readonly db: Firestore) {}

  async create(report: Omit<BugReport, "id">): Promise<BugReport> {
    // `add` mints a random document id — the report has no natural key.
    const ref = await this.db.collection(COLLECTION).add(report);
    return { id: ref.id, ...report };
  }

  async list(): Promise<BugReport[]> {
    // Order by submission time (newest first); the document id is the stable
    // tiebreak for reports sharing a timestamp.
    const snap = await this.db.collection(COLLECTION).orderBy("submittedAt", "desc").get();
    return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<BugReport, "id">) }));
  }

  async markReviewed(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const collection = this.db.collection(COLLECTION);
    const refs = ids.map((id) => collection.doc(id));
    const docs = await this.db.getAll(...refs);
    const batch = this.db.batch();
    let transitioned = 0;
    for (const doc of docs) {
      // Only count-and-write the ones genuinely making the new→reviewed move, so
      // the returned count is truthful and unknown/already-reviewed ids are no-ops.
      if (doc.exists && (doc.data() as BugReport).status === "new") {
        batch.update(doc.ref, { status: "reviewed" });
        transitioned += 1;
      }
    }
    if (transitioned > 0) {
      await batch.commit();
    }
    return transitioned;
  }

  async delete(id: string): Promise<void> {
    // Firestore's delete is idempotent — deleting an absent doc succeeds.
    await this.db.collection(COLLECTION).doc(id).delete();
  }
}

/** An in-memory {@link BugReportStore} double for tests. */
export class InMemoryBugReportStore implements BugReportStore {
  private reports: BugReport[] = [];
  private seq = 0;

  constructor(seed: readonly BugReport[] = []) {
    this.reports = seed.map((r) => ({ ...r }));
    this.seq = seed.length;
  }

  async create(report: Omit<BugReport, "id">): Promise<BugReport> {
    this.seq += 1;
    const created: BugReport = { id: `bug-${this.seq}`, ...report };
    this.reports.push(created);
    return { ...created };
  }

  async list(): Promise<BugReport[]> {
    // Newest first: by submittedAt desc, then insertion order desc as the stable
    // tiebreak (mirrors the Firestore store's timestamp-then-id ordering).
    return [...this.reports]
      .reverse()
      .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0))
      .map((r) => ({ ...r }));
  }

  async markReviewed(ids: readonly string[]): Promise<number> {
    const wanted = new Set(ids);
    let transitioned = 0;
    for (const report of this.reports) {
      if (wanted.has(report.id) && report.status === "new") {
        report.status = "reviewed";
        transitioned += 1;
      }
    }
    return transitioned;
  }

  async delete(id: string): Promise<void> {
    this.reports = this.reports.filter((r) => r.id !== id);
  }
}
