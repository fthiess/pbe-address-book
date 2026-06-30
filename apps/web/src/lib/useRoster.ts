import { useEffect, useState } from "react";
import { fetchProfiles } from "./api.js";
import type { DirectoryProfile } from "./types.js";

/**
 * The session-cached brotherhood roster (Phase 4b-1). The Profile page's
 * Big-Brother typeahead and its **derived Little Brothers** both need the whole
 * in-memory dataset (PRD §5.7.4) — `bigBrotherId` is `public`, so the bulk
 * brother-projection already carries every pointer needed to derive the reverse
 * edge. The fetch is memoized in a module-level promise so opening one profile
 * after another reuses a single download — the byte-frugal path the 60+,
 * slow-link audience needs (the directory's own bulk read stays separate for now).
 */

let cached: Promise<DirectoryProfile[]> | null = null;

function loadRoster(): Promise<DirectoryProfile[]> {
  if (!cached) {
    cached = fetchProfiles()
      .then((response) => response.profiles)
      .catch((error) => {
        // Let a failed load be retried on the next mount rather than caching the rejection.
        cached = null;
        throw error;
      });
  }
  return cached;
}

export interface Roster {
  /** The roster once loaded; `null` while in flight. */
  profiles: DirectoryProfile[] | null;
  error: boolean;
}

export function useRoster(): Roster {
  const [profiles, setProfiles] = useState<DirectoryProfile[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    loadRoster()
      .then((list) => {
        if (active) {
          setProfiles(list);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return { profiles, error };
}

/** Reset the module cache — for tests, which need a fresh fetch per case. */
export function __resetRosterCache(): void {
  cached = null;
}
