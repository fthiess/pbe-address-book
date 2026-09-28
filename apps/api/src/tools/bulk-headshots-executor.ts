/**
 * The side-effecting half of `bulk-headshots.ts` (D182): carry out the planner's
 * decisions against Firestore (the photo pointer) and the image bucket (the
 * objects), in the live upload route's order — objects FIRST, pointer LAST (D98),
 * so a profile never points at objects that do not exist.
 *
 * Every pointer write is conditional on the `updateTime` read just before
 * (`lastUpdateTime` precondition): a record that changed in between is reported
 * `changed` and left alone. The writes touch only `hasHeadshot` and
 * `headshotVersion`; clearing a pointer mirrors `DELETE /api/profiles/:id/headshot`
 * (`hasHeadshot: false`, `headshotVersion` removed).
 *
 * The Firestore seam is a small interface so the emulator suite drives the real
 * `FirestorePointerStore` while the image side uses the in-memory `ImageStore`.
 */
import { headshotObjectKey, thumbnailObjectKey } from "@pbe/shared";
import { FieldValue, type Firestore, type Timestamp } from "firebase-admin/firestore";
import type { ImageStore } from "../data/images.js";
import type { EncodedHeadshot } from "../images/encode.js";
import type {
  ArtifactItem,
  CurrentPointer,
  PurgeDecision,
  RevertDecision,
  UploadDecision,
} from "./bulk-headshots-plan.js";

/** gRPC codes the conditional update can fail with. */
const GRPC_NOT_FOUND = 5;
const GRPC_FAILED_PRECONDITION = 9;
/** Firestore `getAll` handles large batches, but keep requests modest. */
const READ_CHUNK = 300;
const WEBP = "image/webp";

export type PointerWriteResult = "ok" | "changed" | "missing";

/** The photo-pointer seam: read many pointers, conditionally write one. */
export interface PointerStore<Token> {
  read(ids: readonly number[]): Promise<Map<number, CurrentPointer<Token>>>;
  /** Point the profile at `version`, or clear its photo when `version` is null. */
  write(id: number, version: string | null, token: Token): Promise<PointerWriteResult>;
}

export class FirestorePointerStore implements PointerStore<Timestamp> {
  constructor(private readonly db: Firestore) {}

  async read(ids: readonly number[]): Promise<Map<number, CurrentPointer<Timestamp>>> {
    const out = new Map<number, CurrentPointer<Timestamp>>();
    for (let i = 0; i < ids.length; i += READ_CHUNK) {
      const refs = ids
        .slice(i, i + READ_CHUNK)
        .map((id) => this.db.collection("profiles").doc(String(id)));
      if (refs.length === 0) {
        continue;
      }
      const snaps = await this.db.getAll(...refs);
      for (const snap of snaps) {
        if (!snap.exists || !snap.updateTime) {
          continue;
        }
        const data = snap.data() ?? {};
        out.set(Number(snap.id), {
          hasHeadshot: data.hasHeadshot === true,
          headshotVersion: typeof data.headshotVersion === "string" ? data.headshotVersion : null,
          token: snap.updateTime,
        });
      }
    }
    return out;
  }

  async write(id: number, version: string | null, token: Timestamp): Promise<PointerWriteResult> {
    const data =
      version === null
        ? { hasHeadshot: false, headshotVersion: FieldValue.delete() }
        : { hasHeadshot: true, headshotVersion: version };
    try {
      await this.db.collection("profiles").doc(String(id)).update(data, { lastUpdateTime: token });
      return "ok";
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === GRPC_FAILED_PRECONDITION) {
        return "changed";
      }
      if (code === GRPC_NOT_FOUND) {
        return "missing";
      }
      throw error;
    }
  }
}

export interface UploadDeps<Token> {
  readonly pointers: PointerStore<Token>;
  readonly images: ImageStore;
  readonly encode: (bytes: Buffer) => Promise<EncodedHeadshot>;
  /** The PNG bytes for a brother (already read and hashed by the caller). */
  readonly bytesOf: (id: number) => Buffer;
  /** Persist the artifact; called with every item `intended` BEFORE the first write, and again at the end. */
  readonly saveArtifact: (items: readonly ArtifactItem[]) => Promise<void>;
  readonly log?: (line: string) => void;
}

export interface UploadOutcome {
  readonly items: ArtifactItem[];
  readonly errors: string[];
}

/**
 * Upload every `upload` decision. The artifact (the undo list) is saved with all
 * items `intended` before anything is written, so a run that dies part-way still
 * leaves a complete — superset — undo list.
 */
export async function executeUploads<Token>(
  decisions: readonly UploadDecision<Token>[],
  deps: UploadDeps<Token>,
  current: ReadonlyMap<number, CurrentPointer<Token>>,
): Promise<UploadOutcome> {
  const uploads = decisions.filter((d) => d.kind === "upload");
  const items: ArtifactItem[] = uploads.map((d) => {
    const pointer = current.get(d.row.id);
    return {
      id: d.row.id,
      prior: pointer?.hasHeadshot ? pointer.headshotVersion : null,
      next: d.version,
      outcome: "intended",
    };
  });
  await deps.saveArtifact(items);
  const errors: string[] = [];
  for (const [index, decision] of uploads.entries()) {
    const item = items[index] as ArtifactItem;
    const id = decision.row.id;
    try {
      const encoded = await deps.encode(deps.bytesOf(id));
      await Promise.all([
        deps.images.put(headshotObjectKey(id, decision.version), encoded.headshot, WEBP),
        deps.images.put(thumbnailObjectKey(id, decision.version), encoded.thumbnail, WEBP),
      ]);
      const result = await deps.pointers.write(id, decision.version, decision.token);
      item.outcome = result === "ok" ? "written" : result;
    } catch (error) {
      item.outcome = "failed";
      errors.push(`#${id}: ${(error as Error).message}`);
    }
    if ((index + 1) % 50 === 0) {
      deps.log?.(`  ${index + 1}/${uploads.length}`);
    }
  }
  await deps.saveArtifact(items);
  return { items, errors };
}

export interface RevertOutcome {
  readonly reverted: number[];
  readonly skipped: string[];
  readonly errors: string[];
}

/**
 * Undo: point each profile back at its prior photo (or clear it), then delete
 * this run's now-unreferenced objects. The prior photo's objects were never
 * deleted by the upload, so the revert is immediate.
 */
export async function executeUndo<Token>(
  decisions: readonly RevertDecision<Token>[],
  pointers: PointerStore<Token>,
  images: ImageStore,
): Promise<RevertOutcome> {
  const reverted: number[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const decision of decisions) {
    const { id, prior, next } = decision.item;
    if (decision.kind !== "revert") {
      skipped.push(
        decision.kind === "changed"
          ? `#${id}: shows ${decision.found ?? "no photo"}, not this run's photo; left as is`
          : `#${id}: no such profile`,
      );
      continue;
    }
    try {
      const result = await pointers.write(id, prior, decision.token);
      if (result !== "ok") {
        skipped.push(`#${id}: ${result} since the read; left as is`);
        continue;
      }
      reverted.push(id);
      await Promise.all([
        images.delete(headshotObjectKey(id, next)),
        images.delete(thumbnailObjectKey(id, next)),
      ]);
    } catch (error) {
      errors.push(`#${id}: ${(error as Error).message}`);
    }
  }
  return { reverted, skipped, errors };
}

/** Purge: delete the replaced photos' objects. Idempotent (a gone object is fine). */
export async function executePurge(
  decisions: readonly PurgeDecision[],
  images: ImageStore,
): Promise<{ purged: number[]; errors: string[] }> {
  const purged: number[] = [];
  const errors: string[] = [];
  for (const decision of decisions) {
    if (decision.kind !== "purge") {
      continue;
    }
    const { id } = decision.item;
    try {
      await Promise.all([
        images.delete(headshotObjectKey(id, decision.version)),
        images.delete(thumbnailObjectKey(id, decision.version)),
      ]);
      purged.push(id);
    } catch (error) {
      errors.push(`#${id}: ${(error as Error).message}`);
    }
  }
  return { purged, errors };
}
