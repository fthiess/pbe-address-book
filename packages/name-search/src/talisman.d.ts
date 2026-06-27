/**
 * Ambient types for the talisman submodules we use. talisman ships no type
 * declarations of its own, so we declare the narrow surface the matcher needs.
 */
declare module "talisman/phonetics/double-metaphone" {
  /**
   * Double Metaphone — returns the `[primary, secondary]` phonetic codes for a
   * word (the two are equal when the word has a single pronunciation).
   */
  export default function doubleMetaphone(value: string): [string, string];
}
