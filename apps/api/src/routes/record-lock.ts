/**
 * A per-record in-process write serializer (DECISIONS N65).
 *
 * The Ghost-first-gated write path does `Ghost PUT → Firestore write` across an
 * `await` boundary. At `max-instances=1` Node is single-threaded, so the only
 * interleaving points are those awaits — but two concurrent requests editing the
 * **same** record could still let one commit *between* the other's Ghost push and
 * its Firestore write, opening exactly the pushed-field divergence N65 closes. A
 * keyed promise chain removes that window: all mutations of a given record id run
 * one-at-a-time, in arrival order, while different records stay fully concurrent.
 *
 * Scoped to the record-mutating paths that can change a Ghost-pushed field —
 * `PATCH`, `PUT …/deceased`, `PUT …/debrothered` — so any two of them on one
 * record serialize. Read paths and non-pushed-field writes (verify, headshot,
 * stars) do not participate: they cannot create pushed-field divergence, so
 * holding them behind the lock would only add latency.
 */
export class RecordLock {
  private readonly chains = new Map<number, Promise<unknown>>();

  /**
   * Run `task` once every previously-queued task for `id` has settled, returning
   * its result (or rejection) to the caller unchanged. A task that throws does not
   * break the chain — the next waiter still runs — and the map entry is dropped
   * once the queue for that id drains, so it stays bounded by the live roster.
   */
  async run<T>(id: number, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(id) ?? Promise.resolve();
    // Chain off the previous tail regardless of how it settled (both handlers run
    // `task`), so one failed write cannot deadlock the record's queue.
    const result = previous.then(task, task);
    // The stored tail swallows the outcome so a later `.then` always fires and an
    // unhandled rejection is never attached to the map's copy.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(id, tail);
    try {
      return await result;
    } finally {
      // Drop the entry when we are the last waiter, so the map does not accumulate
      // one permanent promise per record ever written.
      if (this.chains.get(id) === tail) {
        this.chains.delete(id);
      }
    }
  }
}
