/**
 * A tiny seeded PRNG (mulberry32) plus a few drawing helpers. No dependency,
 * fully deterministic: the same seed always yields the same sequence, which is
 * what makes the fake dataset reproducible and reviewable (DECISIONS D65). We
 * deliberately do not use Math.random().
 */

/** Returns a function that yields the next float in [0, 1) for the given seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small bundle of deterministic drawing helpers over one PRNG. */
export class Random {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Next float in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Pick one element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Random.pick called on an empty array");
    }
    return items[this.int(0, items.length - 1)] as T;
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }
}
