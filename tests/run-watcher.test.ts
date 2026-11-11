import { describe, expect, it } from "vitest";
import { RunWatcher } from "../electron/run-watcher";

describe("one run watcher for the whole app", () => {
  it("reads once for overlapping callers and pushes only when the run changes", async () => {
    let reads = 0;
    let value: { state: string } | null = { state: "running" };
    const pushed: Array<{ state: string } | null> = [];
    const watcher = new RunWatcher({ read: async () => { reads += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return value; }, onChange: (run) => pushed.push(run) });
    const [a, b, c] = await Promise.all([watcher.current(), watcher.current(), watcher.check()]);
    expect([a, b, c]).toEqual([value, value, value]);
    expect(reads).toBe(1);
    await watcher.check();
    expect(pushed).toEqual([]);
    value = { state: "passed" };
    await watcher.check();
    await watcher.check();
    expect(pushed).toEqual([{ state: "passed" }]);
    watcher.reset();
    expect(await watcher.current()).toEqual({ state: "passed" });
    expect(pushed).toHaveLength(1);
  });

  it("treats a failed read as no run instead of throwing", async () => {
    const watcher = new RunWatcher({ read: async () => { throw new Error("disk"); }, onChange: () => undefined });
    expect(await watcher.current()).toBeNull();
  });
});
