import { describe, expect, it } from "vitest";
import { RecordLock } from "./record-lock.js";

/** A deferred promise so a test can control exactly when a task resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("RecordLock (per-record write serializer, N65)", () => {
  it("runs same-id tasks one at a time, in arrival order", async () => {
    const lock = new RecordLock();
    const order: string[] = [];
    const a = deferred<void>();
    const b = deferred<void>();

    const first = lock.run(1, async () => {
      order.push("a:start");
      await a.promise;
      order.push("a:end");
    });
    const second = lock.run(1, async () => {
      order.push("b:start");
      await b.promise;
      order.push("b:end");
    });

    // The second task must not start until the first finishes.
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    a.resolve();
    await first;
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
    b.resolve();
    await second;
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("runs different-id tasks concurrently", async () => {
    const lock = new RecordLock();
    const order: string[] = [];
    const one = deferred<void>();

    const p1 = lock.run(1, async () => {
      order.push("1:start");
      await one.promise;
      order.push("1:end");
    });
    const p2 = lock.run(2, async () => {
      order.push("2:start");
    });

    await p2;
    // id 2 finished while id 1 is still blocked on its deferred.
    expect(order).toEqual(["1:start", "2:start"]);
    one.resolve();
    await p1;
    expect(order).toEqual(["1:start", "2:start", "1:end"]);
  });

  it("a failing task does not deadlock the record's queue", async () => {
    const lock = new RecordLock();
    await expect(
      lock.run(1, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The next same-id task still runs.
    await expect(lock.run(1, async () => "ok")).resolves.toBe("ok");
  });

  it("returns the task's resolved value to its caller", async () => {
    const lock = new RecordLock();
    await expect(lock.run(7, async () => 42)).resolves.toBe(42);
  });
});
