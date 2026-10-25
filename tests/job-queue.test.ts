import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJobQueue, saveJobQueue } from "../electron/job-queue";
import { advanceQueue, agyReadiness } from "../src/shared/job-queue";
import type { JobQueue, RunStatus } from "../src/shared/schemas";

const item = (id: string, status: JobQueue["items"][number]["status"] = "queued", sentAt: string | null = null) => ({ id, url: `https://jobs.example.com/${id}`, addedAt: "2026-10-25T10:00:00Z", status, sentAt, finishedAt: null, jobId: null });
const run = (at: string, state: RunStatus["state"]): RunStatus => ({ kind: "application", jobId: "northstar-analyst", roundId: null, label: "Northstar Labs", at, durationSeconds: 60, state, fitScore: 4, gate: null, issues: [] });

describe("job queue", () => {
  it("sends one link at a time and finishes it when its application run completes", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    const start = advanceQueue({ autoRun: true, items: [item("job-aaaa"), item("job-bbbb")] }, null, now);
    expect(start.send?.id).toBe("job-aaaa");
    expect(start.queue.items.map((entry) => entry.status)).toEqual(["running", "queued"]);
    const waiting = advanceQueue(start.queue, run("2026-10-25T12:00:30Z", "running"), now + 60_000);
    expect(waiting.send).toBeNull();
    const finished = advanceQueue(waiting.queue, run("2026-10-25T12:01:30Z", "warnings"), now + 120_000);
    expect(finished.queue.items[0]).toMatchObject({ status: "done", jobId: "northstar-analyst" });
    expect(finished.send?.id).toBe("job-bbbb");
  });

  it("ignores runs from before the link was sent, pauses on timeout, and respects auto-run off", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    const queue: JobQueue = { autoRun: true, items: [item("job-aaaa", "running", "2026-10-25T12:00:00Z"), item("job-bbbb")] };
    expect(advanceQueue(queue, run("2026-10-25T11:50:00Z", "passed"), now + 60_000).queue.items[0]!.status).toBe("running");
    const late = advanceQueue(queue, null, now + 13 * 60_000);
    expect(late.queue.items[0]!.status).toBe("needs_attention");
    expect(late.send).toBeNull();
    expect(advanceQueue({ autoRun: false, items: [item("job-cccc")] }, null, now).send).toBeNull();
  });

  it("saves only valid queues", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-queue-"));
    expect(await readJobQueue(root)).toEqual({ autoRun: true, items: [] });
    await saveJobQueue(root, { autoRun: false, items: [item("job-aaaa")] });
    expect((await readJobQueue(root)).items).toHaveLength(1);
    await expect(saveJobQueue(root, { items: [{ ...item("job-bbbb"), url: "javascript:alert(1)" }] })).rejects.toThrow();
  });

  it("waits for Agy: queued links stay queued until Agy is running, signed in, and idle", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    const waiting = advanceQueue({ autoRun: true, items: [item("job-aaaa"), item("job-bbbb")] }, null, now, false);
    expect(waiting.send).toBeNull();
    expect(waiting.queue.items.map((entry) => entry.status)).toEqual(["queued", "queued"]);
    const base = { running: true, agy: true, startedAt: now - 60_000, lastOutputAt: now - 10_000, recentOutput: "Welcome to the Antigravity CLI. You are currently not signed in. Signing in...\n> \u001b[2mGemini 3.8 Flash · medium\u001b[0m" };
    expect(agyReadiness(base, now)).toBe(true);
    expect(agyReadiness({ ...base, running: false }, now)).toBe(false);
    expect(agyReadiness({ ...base, agy: false }, now)).toBe(false);
    expect(agyReadiness({ ...base, startedAt: now - 1000 }, now)).toBe(false);
    expect(agyReadiness({ ...base, lastOutputAt: now - 1000 }, now)).toBe(false);
    // Never signed in: the login menu, and no status line.
    expect(agyReadiness({ ...base, recentOutput: "Welcome to the Antigravity CLI. You are currently not signed in. Signing in... Select login method: > 1. Google OAuth 2. Use a Google Cloud project" }, now)).toBe(false);
    // Signed in but asked to trust the folder (captured order: the question, then the status line).
    expect(agyReadiness({ ...base, recentOutput: "You are currently not signed in. Signing in...Accessing workspace: /tmp/ws Do you trust the contents of this project? Antigravity CLI requires permission to read, edit, and execute files here. > Yes, I trust this folder No, exit ↑/↓ Navigate · enter ConfirmGemini 3.8 Flash · medium" }, now)).toBe(false);
    expect(agyReadiness({ ...base, recentOutput: "Waiting for authentication (timeout 60s)... Or, paste the authorization code here" }, now)).toBe(false);
    expect(advanceQueue(waiting.queue, null, now, true).send?.id).toBe("job-aaaa");
  });
});
