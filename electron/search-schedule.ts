/**
 * Installs or removes the OS schedule that runs Job Search while the app is closed: a per-user launchd agent on
 * macOS (a run missed while the Mac slept runs when it wakes), a per-user Task Scheduler task on Windows (missed
 * runs start as soon as possible). Nothing needs administrator rights.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import type { JobSearchSettings } from "../src/shared/job-search";

export type ScheduleTarget = {
  /** The app's runtime (process.execPath), run as Node. */
  runtime: string;
  /** Compiled runner script (dist-electron/electron/job-search-runner.js). */
  runner: string;
  workspace: string;
  userData: string;
};

export type ScheduleInfo = { supported: boolean; installed: boolean; label: string; detail: string; platform: string };

/** One schedule per app data folder, so a test profile never replaces the real one. */
export function scheduleLabel(userData: string): string {
  return `com.jobsensei.jobsearch.${createHash("sha256").update(userData).digest("hex").slice(0, 8)}`;
}

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function launchdPlist(label: string, target: ScheduleTarget, schedule: JobSearchSettings["schedule"]): string {
  const days = schedule.days.length ? [...new Set(schedule.days)].sort() : [0, 1, 2, 3, 4, 5, 6];
  // Daily mode: a check every hour, on the set time's minute (so one lands exactly at the set time), and one at login.
  // A check missed during sleep runs once on wake (calendar intervals catch up; plain intervals are unreliable after
  // sleep). The runner decides whether this is the window's first chance (dailyRunDue), so extra checks cost nothing.
  const [, afterMinute] = schedule.after.split(":").map(Number);
  const intervals = schedule.mode === "daily"
    ? [`    <dict><key>Minute</key><integer>${afterMinute}</integer></dict>`]
    : days.flatMap((day) => schedule.times.map((time) => {
      const [hour, minute] = time.split(":").map(Number);
      return `    <dict><key>Weekday</key><integer>${day}</integer><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`;
    }));
  const args = [target.runtime, target.runner, "--workspace", target.workspace, "--user-data", target.userData];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>ELECTRON_RUN_AS_NODE</key><string>1</string></dict>
  <key>StartCalendarInterval</key>
  <array>
${intervals.join("\n")}
  </array>
${schedule.mode === "daily" ? "  <key>RunAtLoad</key><true/>\n" : ""}  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>${xml(join(target.userData, "job-search-schedule.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(target.userData, "job-search-schedule.log"))}</string>
</dict>
</plist>
`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Task Scheduler XML (one weekly trigger per time; runs only when the user is logged on, no admin rights). */
const RESUME_QUERY = "<QueryList><Query Id=\"0\" Path=\"System\"><Select Path=\"System\">*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]</Select></Query></QueryList>";

export function windowsTaskXml(target: ScheduleTarget, schedule: JobSearchSettings["schedule"], today = new Date(), user = ""): string {
  const days = (schedule.days.length ? [...new Set(schedule.days)].sort() : [0, 1, 2, 3, 4, 5, 6]).map((day) => `<${WEEKDAYS[day]} />`).join("");
  const date = today.toISOString().slice(0, 10);
  // Daily mode: at the set time and then hourly around the clock (a missed one starts when available), at sign-in, and
  // when the PC resumes from sleep (Power-Troubleshooter event 1). The runner keeps it to the window's first chance.
  const triggers = schedule.mode === "daily" ? [
    `    <CalendarTrigger><StartBoundary>${date}T${schedule.after}:00</StartBoundary><Repetition><Interval>PT1H</Interval><Duration>P1D</Duration></Repetition><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`,
    `    <LogonTrigger><Enabled>true</Enabled>${user ? `<UserId>${xml(user)}</UserId>` : ""}<Delay>PT1M</Delay></LogonTrigger>`,
    `    <EventTrigger><Enabled>true</Enabled><Subscription>${xml(RESUME_QUERY)}</Subscription><Delay>PT1M</Delay></EventTrigger>`,
  ].join("\n") : schedule.times.map((time) => `    <CalendarTrigger><StartBoundary>${date}T${time}:00</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><DaysOfWeek>${days}</DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger>`).join("\n");
  const quote = (value: string) => `"${value}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>JobSensei: scheduled job search</Description></RegistrationInfo>
  <Triggers>
${triggers}
  </Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <WakeToRun>${schedule.wake && schedule.mode === "times" ? "true" : "false"}</WakeToRun>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>${xml(`/d /c set ELECTRON_RUN_AS_NODE=1&& ${quote(target.runtime)} ${quote(target.runner)} --workspace ${quote(target.workspace)} --user-data ${quote(target.userData)}`)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

const run = (command: string, args: string[]) => new Promise<{ code: number; output: string }>((resolve) => {
  execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, output: `${stdout}${stderr}`.trim() }));
});

const plistPath = (label: string) => join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const windowsTaskName = (label: string) => `JobSensei\\${label}`;

export async function scheduleInfo(userData: string): Promise<ScheduleInfo> {
  const label = scheduleLabel(userData);
  if (process.platform === "darwin") {
    const file = await stat(plistPath(label)).catch(() => null);
    const loaded = file ? (await run("launchctl", ["print", `gui/${userInfo().uid}/${label}`])).code === 0 : false;
    return { platform: process.platform, supported: true, installed: Boolean(file) && loaded, label, detail: file ? (loaded ? "Scheduled with macOS (launchd)." : "The schedule file exists but macOS hasn't loaded it.") : "Not scheduled." };
  }
  if (process.platform === "win32") {
    const result = await run("schtasks", ["/Query", "/TN", windowsTaskName(label)]);
    return { platform: process.platform, supported: true, installed: result.code === 0, label, detail: result.code === 0 ? "Scheduled with Windows Task Scheduler." : "Not scheduled." };
  }
  return { platform: process.platform, supported: false, installed: false, label, detail: "Scheduled searches work on macOS and Windows." };
}

/** Installs (or replaces) the schedule. */
export async function installSchedule(target: ScheduleTarget, schedule: JobSearchSettings["schedule"]): Promise<ScheduleInfo> {
  const label = scheduleLabel(target.userData);
  if (process.platform === "darwin") {
    const file = plistPath(label);
    await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
    await run("launchctl", ["bootout", `gui/${userInfo().uid}`, file]);
    await writeFile(file, launchdPlist(label, target, schedule));
    const loaded = await run("launchctl", ["bootstrap", `gui/${userInfo().uid}`, file]);
    if (loaded.code !== 0) throw new Error(`macOS didn't accept the schedule: ${loaded.output.slice(0, 200)}`);
  } else if (process.platform === "win32") {
    const file = join(target.userData, "job-search-task.xml");
    // Task Scheduler reads UTF-16 XML.
    const user = [process.env.USERDOMAIN, process.env.USERNAME ?? userInfo().username].filter(Boolean).join("\\");
    await writeFile(file, `\ufeff${windowsTaskXml(target, schedule, new Date(), user)}`, "utf16le");
    const created = await run("schtasks", ["/Create", "/TN", windowsTaskName(label), "/XML", file, "/F"]);
    if (created.code !== 0) throw new Error(`Windows didn't accept the schedule: ${created.output.slice(0, 200)}`);
  } else {
    throw new Error("Scheduled searches work on macOS and Windows.");
  }
  return scheduleInfo(target.userData);
}

export async function removeSchedule(userData: string): Promise<ScheduleInfo> {
  const label = scheduleLabel(userData);
  if (process.platform === "darwin") {
    await run("launchctl", ["bootout", `gui/${userInfo().uid}`, plistPath(label)]);
    await rm(plistPath(label), { force: true });
  } else if (process.platform === "win32") {
    await run("schtasks", ["/Delete", "/TN", windowsTaskName(label), "/F"]);
  }
  return scheduleInfo(userData);
}
