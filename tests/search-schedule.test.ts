import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchdPlist, scheduleLabel, windowsTaskXml } from "../electron/search-schedule";
import { runnerArgs, waitForNetwork } from "../electron/job-search-runner";
import { clearPendingDrafts, readSearchState, releaseSearchLock, saveSearchState, searchLockHolder, takeSearchLock } from "../electron/job-search";
import { EMPTY_JOB_SEARCH_STATE, dailyRunDue, windowStart, type SearchRun, scheduledAgyToday } from "../src/shared/job-search";

const target = { runtime: "/Apps/Job Sensei.app/Contents/MacOS/JobSensei", runner: "/Apps/app.asar/dist-electron/electron/job-search-runner.js", workspace: "/workspaces/JobSensei & co", userData: "/app-data/JobSensei" };
const schedule = { enabled: true, mode: "times" as const, after: "08:00", days: [1, 3, 5], times: ["08:00", "17:30"], wake: false };
const daily = { ...schedule, mode: "daily" as const, days: [0, 1, 2, 3, 4, 5, 6] };

describe("search schedule files", () => {
  it("writes a launchd agent with one calendar entry per day and time, run as Node", async () => {
    const plist = launchdPlist(scheduleLabel(target.userData), target, schedule);
    expect(plist.match(/<key>Weekday<\/key>/g)).toHaveLength(6);
    expect(plist).toContain("<key>Hour</key><integer>17</integer><key>Minute</key><integer>30</integer>");
    expect(plist).toContain("<key>ELECTRON_RUN_AS_NODE</key><string>1</string>");
    expect(plist).toContain("JobSensei &amp; co");
    if (process.platform === "darwin") {
      const file = join(await mkdtemp(join(tmpdir(), "sensei-plist-")), "test.plist");
      await writeFile(file, plist);
      expect(execFileSync("plutil", ["-lint", file]).toString()).toContain("OK");
    }
  });

  it("writes a Task Scheduler task that catches up on missed runs without admin rights", () => {
    const task = windowsTaskXml(target, schedule, new Date("2026-11-06T00:00:00Z"));
    expect(task.match(/<CalendarTrigger>/g)).toHaveLength(2);
    expect(task).toContain("<Monday /><Wednesday /><Friday />");
    expect(task).toContain("<StartBoundary>2026-11-06T17:30:00</StartBoundary>");
    expect(task).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
    expect(task).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(task).toContain("set ELECTRON_RUN_AS_NODE=1&amp;&amp;");
    expect(task).toContain("<WakeToRun>false</WakeToRun>");
    expect(windowsTaskXml(target, { ...schedule, wake: true })).toContain("<WakeToRun>true</WakeToRun>");
  });

  it("keeps a test profile's schedule apart from the real one", () => {
    expect(scheduleLabel("/a")).not.toBe(scheduleLabel("/b"));
    expect(scheduleLabel("/a")).toMatch(/^com\.jobsensei\.jobsearch\.[0-9a-f]{8}$/);
  });

  it("reads the runner's arguments", () => {
    expect(runnerArgs(["--workspace", "/w", "--user-data", "/u"])).toEqual({ workspace: "/w", userData: "/u" });
    expect(runnerArgs(["--workspace", "/w"])).toBeNull();
  });
});

describe("one search at a time", () => {
  it("blocks while another live process holds the lock, and frees a dead one's", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-lock-"));
    expect(await takeSearchLock(workspace, "app")).toEqual({ ok: true });
    await releaseSearchLock(workspace);
    expect(await searchLockHolder(workspace)).toBeNull();
    await writeFile(join(workspace, ".sensei/job-search/run.lock"), JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString(), by: "schedule" }));
    expect(await takeSearchLock(workspace, "app")).toEqual({ ok: false, by: "schedule" });
    await writeFile(join(workspace, ".sensei/job-search/run.lock"), JSON.stringify({ pid: 999_999, startedAt: new Date().toISOString(), by: "schedule" }));
    expect(await takeSearchLock(workspace, "app")).toEqual({ ok: true });
  });

  it("never drops runs, found jobs, or seen links", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-lock-"));
    const runs = Array.from({ length: 45 }, (_, n): SearchRun => ({ id: `run-${n}`, startedAt: new Date(2026, 0, 1 + n).toISOString(), finishedAt: null, status: "done", found: 1, added: 1, leftOut: {}, autoQueued: 0, replaced: 0, rated: 0, source: "search", scheduled: false, error: null }));
    const seen = Array.from({ length: 3500 }, (_, n) => `https://jobs.lever.co/acme/${n}`);
    await saveSearchState(workspace, { ...EMPTY_JOB_SEARCH_STATE, runs, seen });
    const state = await readSearchState(workspace);
    expect(state.runs).toHaveLength(45);
    expect(state.seen).toHaveLength(3500);
  });

  it("clears drafts the app has queued", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-lock-"));
    await saveSearchState(workspace, { ...EMPTY_JOB_SEARCH_STATE, pendingDrafts: ["find-aaaa1", "find-bbbb2"] });
    await clearPendingDrafts(workspace, ["find-aaaa1"]);
    expect((await readSearchState(workspace)).pendingDrafts).toEqual(["find-bbbb2"]);
  });
});

describe("once per window, from the set time to the same time next day", () => {
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute); // Nov 9 2026 is a Monday
  const run = (when: Date, patch: Partial<SearchRun> = {}): SearchRun => ({ id: `run-${when.getTime()}`, startedAt: when.toISOString(), finishedAt: when.toISOString(), status: "done", found: 1, added: 1, leftOut: {}, autoQueued: 0, replaced: 0, rated: 0, source: "search", scheduled: true, error: null, ...patch });

  it("follows the example: Monday 8:30 runs, Tuesday 1 a.m. doesn't, Tuesday 9:30 runs", () => {
    expect(dailyRunDue([], daily, at(9, 8, 30)).due).toBe(true);
    const monday = [run(at(9, 8, 30))];
    expect(dailyRunDue(monday, daily, at(9, 22)).reason).toBe("already searched in this window");
    expect(dailyRunDue(monday, daily, at(10, 1)).reason).toBe("already searched in this window");
    expect(dailyRunDue(monday, daily, at(10, 9, 30)).due).toBe(true);
  });

  it("runs once in a window that had no search yet, even before the set time the next morning", () => {
    expect(windowStart("08:00", at(10, 1)).getTime()).toBe(at(9, 8).getTime());
    expect(dailyRunDue([run(at(8, 9))], daily, at(10, 1)).due).toBe(true);
  });

  it("counts only a finished scheduled search: the user's own searches and failed runs don't", () => {
    expect(dailyRunDue([run(at(9, 9), { scheduled: false })], daily, at(9, 10)).due).toBe(true);
    expect(dailyRunDue([run(at(9, 9), { status: "failed" })], daily, at(9, 10)).due).toBe(true);
    // A scheduled watched-only search (the user's "watched companies only" setting) is the day's search.
    expect(dailyRunDue([run(at(9, 9), { source: "watched" })], daily, at(9, 10)).due).toBe(false);
  });

  it("retries only Agy's part once when it failed while watched companies finished", () => {
    const partial = run(at(9, 9), { agyFailed: true });
    expect(dailyRunDue([partial], daily, at(9, 12))).toMatchObject({ due: true, agyOnly: true });
    expect(dailyRunDue([partial, run(at(9, 12), { agyOnly: true, status: "failed" })], daily, at(9, 15)).due).toBe(false);
    expect(dailyRunDue([partial, run(at(9, 12), { agyOnly: true })], daily, at(9, 15)).due).toBe(false);
    // A new window starts fresh.
    expect(dailyRunDue([partial], daily, at(10, 9))).toMatchObject({ due: true, agyOnly: false });
  });

  it("runs Agy's search on the days the user chose", () => {
    const schedule = { after: "08:00", agy: "days" as const, agyDays: [1] };
    expect(scheduledAgyToday({ ...schedule, agy: "every" }, at(10, 9))).toBe(true);
    expect(scheduledAgyToday({ ...schedule, agy: "never" }, at(10, 9))).toBe(false);
    const monday = [8, 9, 10, 11, 12, 13, 14].find((day) => at(day, 9).getDay() === 1)!;
    expect(scheduledAgyToday(schedule, at(monday, 9))).toBe(true);
    expect(scheduledAgyToday(schedule, at(monday + 1, 9))).toBe(false);
    // Before the set time, the window (and its day) is yesterday's.
    expect(scheduledAgyToday(schedule, at(monday + 1, 7))).toBe(true);
  });

  it("uses the day the window starts on for the chosen days", () => {
    const weekdays = { ...daily, days: [1, 2, 3, 4, 5] };
    expect(dailyRunDue([], weekdays, at(14, 10)).reason).toBe("not a search day"); // Saturday
    expect(dailyRunDue([], weekdays, at(14, 7)).due).toBe(true); // Saturday 7 a.m. is still Friday's window
  });

  it("checks once a day at the set time and at login (macOS); at the set time, sign-in, and resume (Windows)", async () => {
    const plist = launchdPlist(scheduleLabel(target.userData), target, daily);
    expect(plist.match(/<key>Minute<\/key>/g)).toHaveLength(1);
    expect(plist).toContain("<dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>");
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    if (process.platform === "darwin") {
      const file = join(await mkdtemp(join(tmpdir(), "sensei-plist-")), "daily.plist");
      await writeFile(file, plist);
      expect(execFileSync("plutil", ["-lint", file]).toString()).toContain("OK");
    }
    const task = windowsTaskXml(target, { ...daily, wake: true }, new Date("2026-11-06T00:00:00Z"), "PC\\alex");
    expect(task).toContain("<LogonTrigger><Enabled>true</Enabled><UserId>PC\\alex</UserId>");
    expect(task).toContain("Microsoft-Windows-Power-Troubleshooter");
    expect(task).not.toContain("<Repetition>");
    expect(task).toContain("<StartBoundary>2026-11-06T08:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay>");
    expect(task).toContain("<WakeToRun>false</WakeToRun>");
  });

  it("waits for the network after a wake and gives up quietly", async () => {
    let calls = 0;
    const offline = (async () => { calls += 1; throw new Error("offline"); }) as typeof fetch;
    expect(await waitForNetwork(offline, 3, 0)).toBe(false);
    expect(calls).toBe(3);
    expect(await waitForNetwork((async () => new Response(null, { status: 204 })) as typeof fetch, 3, 0)).toBe(true);
  });
});
