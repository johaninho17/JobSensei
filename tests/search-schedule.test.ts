import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchdPlist, scheduleLabel, windowsTaskXml } from "../electron/search-schedule";
import { runnerArgs, waitForNetwork } from "../electron/job-search-runner";
import { clearPendingDrafts, readSearchState, releaseSearchLock, saveSearchState, searchLockHolder, takeSearchLock } from "../electron/job-search";
import { EMPTY_JOB_SEARCH_STATE, dailyRunDue, type SearchRun } from "../src/shared/job-search";

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

  it("clears drafts the app has queued", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-lock-"));
    await saveSearchState(workspace, { ...EMPTY_JOB_SEARCH_STATE, pendingDrafts: ["find-aaaa1", "find-bbbb2"] });
    await clearPendingDrafts(workspace, ["find-aaaa1"]);
    expect((await readSearchState(workspace)).pendingDrafts).toEqual(["find-bbbb2"]);
  });
});

describe("once a day, first time on after the start time", () => {
  const at = (hour: number, minute = 0) => new Date(2026, 10, 6, hour, minute);
  const run = (when: Date, patch: Partial<SearchRun> = {}): SearchRun => ({ id: `run-${when.getTime()}`, startedAt: when.toISOString(), finishedAt: when.toISOString(), status: "done", found: 1, added: 1, leftOut: {}, autoQueued: 0, replaced: 0, rated: 0, source: "search", scheduled: true, error: null, ...patch });

  it("never runs before the start time (a 1 a.m. session), then runs the first time after it, once", () => {
    expect(dailyRunDue([], daily, at(1))).toEqual({ due: false, reason: "before 08:00" });
    expect(dailyRunDue([], daily, at(8, 40)).due).toBe(true);
    expect(dailyRunDue([run(at(8, 41))], daily, at(13)).reason).toBe("already searched today");
    expect(dailyRunDue([run(new Date(2026, 10, 5, 9))], daily, at(9)).due).toBe(true);
  });

  it("counts a search the user ran after the start time, but not one before it, a failed one, or watched-only", () => {
    expect(dailyRunDue([run(at(9), { scheduled: false })], daily, at(10)).due).toBe(false);
    expect(dailyRunDue([run(at(7), { scheduled: false })], daily, at(10)).due).toBe(true);
    expect(dailyRunDue([run(at(9), { status: "failed" })], daily, at(10)).due).toBe(true);
    expect(dailyRunDue([run(at(9), { source: "watched" })], daily, at(10)).due).toBe(true);
    expect(dailyRunDue([], { ...daily, days: [1] }, at(10)).reason).toBe("not a search day");
  });

  it("schedules hourly checks from the start time and one at login (macOS), resume and sign-in triggers (Windows)", async () => {
    const plist = launchdPlist(scheduleLabel(target.userData), target, daily);
    expect(plist.match(/<key>Hour<\/key>/g)).toHaveLength(16);
    expect(plist).not.toContain("<key>Weekday</key>");
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    if (process.platform === "darwin") {
      const file = join(await mkdtemp(join(tmpdir(), "sensei-plist-")), "daily.plist");
      await writeFile(file, plist);
      expect(execFileSync("plutil", ["-lint", file]).toString()).toContain("OK");
    }
    const task = windowsTaskXml(target, { ...daily, wake: true }, new Date("2026-11-06T00:00:00Z"), "PC\\alex");
    expect(task).toContain("<LogonTrigger><Enabled>true</Enabled><UserId>PC\\alex</UserId>");
    expect(task).toContain("Microsoft-Windows-Power-Troubleshooter");
    expect(task).toContain("<Interval>PT1H</Interval><Duration>PT16H</Duration>");
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
