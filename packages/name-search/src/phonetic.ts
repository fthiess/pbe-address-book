import { Accuracy, Encoder } from "bmpm";
import doubleMetaphone from "talisman/phonetics/double-metaphone";
import type { PhoneticAlgorithm } from "./types.js";

/**
 * Phonetic-code generation for a single name token (D35/D66). Two tokens "sound
 * alike" — and so match — when their code sets intersect. The algorithm is the
 * A/B choice (D66):
 *
 *   - **Double Metaphone** (talisman): compact, English-centric, two codes/token.
 *   - **Beider-Morse** (bmpm): many codes/token, far stronger on the non-English
 *     names of a globally-drawn brotherhood — run in the recall-favoring
 *     `APPROX` / `"any"`-language mode.
 *
 * Codes are computed each load, never stored, consistent with the no-on-disk-PII
 * posture (D95/D110). The Beider-Morse encoder loads sizeable rule tables, so it
 * is constructed lazily on first use — the Double-Metaphone path never pays for it.
 */
let beiderMorse: Encoder | null = null;

function beiderMorseCodes(token: string): string[] {
  if (!beiderMorse) {
    // APPROX + "any" is the broadest, most recall-favoring configuration (D66).
    beiderMorse = new Encoder(Accuracy.APPROX, "any");
  }
  return beiderMorse.encode(token);
}

/** Double Metaphone, returning one or two non-empty codes. */
function doubleMetaphoneCodes(token: string): string[] {
  const [primary, secondary] = doubleMetaphone(token);
  const codes: string[] = [];
  if (primary) {
    codes.push(primary);
  }
  if (secondary && secondary !== primary) {
    codes.push(secondary);
  }
  return codes;
}

/**
 * The phonetic codes for a folded token under the chosen algorithm. Returns an
 * empty list for `none`, an empty token, or a token the algorithm can't encode.
 */
export function phoneticCodes(token: string, algorithm: PhoneticAlgorithm): string[] {
  if (!token || algorithm === "none") {
    return [];
  }
  if (algorithm === "beider-morse") {
    return beiderMorseCodes(token).filter((code) => code.length > 0);
  }
  return doubleMetaphoneCodes(token).filter((code) => code.length > 0);
}
