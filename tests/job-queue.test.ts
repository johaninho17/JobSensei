import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJobQueue, saveJobQueue } from "../electron/job-queue";
import { advanceQueue, agyReadiness, classifyAgyScreen, newQueueItem, promptForItem } from "../src/shared/job-queue";
import type { JobQueue, RunStatus } from "../src/shared/schemas";

const item = (id: string, status: JobQueue["items"][number]["status"] = "queued", sentAt: string | null = null) => ({ id, kind: "link" as const, url: `https://jobs.example.com/${id}`, label: null, note: null, manual: false, addedAt: "2026-10-25T10:00:00Z", status, sentAt, finishedAt: null, jobId: null });
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

  it("keeps the screen state when the status line scrolls out of the buffer", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(classifyAgyScreen("> ? for shortcutsGemini 4 Argon · medium")).toBe("ready");
    expect(classifyAgyScreen("┃ Verbosity is now medium by default ┃ esc to dismiss")).toBe("unknown");
    expect(classifyAgyScreen("Gemini 4 Argon · medium ⣯ Generating... ⚠ Individual quota reached. Please upgrade your subscription to increase your limits.")).toBe("blocked");
    // A sandbox-bypass approval waits for the user even with the status line drawn below it.
    expect(classifyAgyScreen("Confirm the command is safe to run outside of the sandbox with full network and disk access. Gemini 4 Argon · medium")).toBe("blocked");
    expect(classifyAgyScreen("Reason: outside workspace Allow access to this file? > 1. Yes, allow access esc to cancelGemini 4 Argon · medium")).toBe("blocked");
    // The main process remembers "ready" even though the recent output no longer contains the status line.
    expect(agyReadiness({ running: true, agy: true, startedAt: now - 60_000, lastOutputAt: now - 20_000, recentOutput: "(Google AI Pro)", screen: "ready" }, now)).toBe(true);
    expect(agyReadiness({ running: true, agy: true, startedAt: now - 60_000, lastOutputAt: now - 20_000, recentOutput: "(Google AI Pro)", screen: "blocked" }, now)).toBe(false);
  });
});

describe("pasted jobs in the queue", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  const paste = (label: string, manual = true) => newQueueItem({ kind: "paste", label }, now, manual);

  it("never sends a second paste while the first is running", () => {
    const first = paste("Northstar Labs, Support Engineer");
    const second = paste("Northstar Labs, Solution Analyst");
    const start = advanceQueue({ autoRun: true, items: [first, second] }, null, now.getTime());
    expect(start.send?.id).toBe(first.id);
    expect(promptForItem(start.send!)).toContain(`paste ID ${first.id}`);
    const later = advanceQueue(start.queue, run("2026-10-26T10:01:00Z", "running"), now.getTime() + 90_000);
    expect(later.send).toBeNull();
    expect(later.queue.items[1]!.status).toBe("queued");
  });

  it("runs chat items while automatic running is paused, but not other queued links", () => {
    const fromChat = paste("Northstar Labs, Support Engineer");
    const paused = advanceQueue({ autoRun: false, items: [item("job-aaaa"), fromChat] }, null, now.getTime());
    expect(paused.send?.id).toBe(fromChat.id);
    expect(paused.queue.items[0]!.status).toBe("queued");
  });

  it("gives pastes IDs that jd:fetch --staged accepts and sends links as before", () => {
    expect(paste("x").id).toMatch(/^paste-[a-z0-9-]{4,40}$/);
    const link = newQueueItem({ kind: "link", url: "https://jobs.example.com/1" }, now);
    expect(promptForItem(link)).toBe("Evaluate this job and draft the application: https://jobs.example.com/1");
    const noted = newQueueItem({ kind: "paste", label: null, note: "focus on\nthe API work" }, now, true);
    expect(promptForItem(noted)).toBe(`Evaluate the job description I pasted (paste ID ${noted.id}) and draft the application. Note: focus on the API work`);
  });
});

describe("Agy first-run screens", () => {
  it("treats the theme picker and the terms consent as waiting for the user, even below a status line", async () => {
    const { classifyAgyScreen } = await import("../src/shared/job-queue");
    const status = "Gemini 4 Argon · medium";
    expect(classifyAgyScreen(`${status}\n  ↑/↓ Navigate · enter Confirm`)).toBe("blocked");
    expect(classifyAgyScreen(`${status}\nTerms of Service & Data Use\n> [x] Yes, I agree to help improve Antigravity CLI`)).toBe("blocked");
    expect(classifyAgyScreen(`Terms of Service & Data Use\n[Done]\n\n${status}`)).toBe("ready");
  });
});

describe("Agy's first-run screens", () => {
  it("never count as ready, so the queue doesn't type a job into them", async () => {
    const { classifyAgyScreen } = await import("../src/shared/job-queue");
    expect(classifyAgyScreen("Welcome to Antigravity CLI!\nChoose your color scheme:\n  > terminal\n    light\n[Next]\n  ↑/↓ Navigate · enter ConfirmGemini 4 Argon · medium")).toBe("blocked");
    expect(classifyAgyScreen("Terms of Service & Data Use\n  > [x] Yes, I agree\n[Previous]      [Done]\nToggle")).toBe("blocked");
    expect(classifyAgyScreen("> Type your message\nGemini 4 Argon · medium")).toBe("ready");
  });
});

describe("when a chat run ends", () => {
  const base = { running: true, agy: true, startedAt: 1_000, lastOutputAt: 100_000, recentOutput: "", screen: "ready" as const };
  it("stays running through a quiet stretch until Agy is idle on its ready screen", async () => {
    const { chatRunState } = await import("../src/shared/job-queue");
    const started = 100_000;
    // Just sent: never done in the first seconds, whatever the screen says.
    expect(chatRunState({ ...base, lastOutputAt: 90_000 }, started, started + 2_000)).toBe("running");
    // Output 3 s ago (a pause while Agy thinks): still running. This is the case the old 2.5 s timer got wrong.
    expect(chatRunState({ ...base, lastOutputAt: started + 20_000 }, started, started + 23_000)).toBe("running");
    // Waiting on an approval screen: still running.
    expect(chatRunState({ ...base, screen: "blocked", lastOutputAt: started + 20_000 }, started, started + 60_000)).toBe("running");
    // Idle on the ready screen: done.
    expect(chatRunState({ ...base, lastOutputAt: started + 20_000 }, started, started + 26_000)).toBe("done");
    expect(chatRunState({ ...base, running: false }, started, started + 26_000)).toBe("stopped");
    expect(chatRunState({ ...base, agy: false }, started, started + 26_000)).toBe("unknown");
  });
});
