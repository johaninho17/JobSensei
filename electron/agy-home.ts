import { existsSync, readdirSync, realpathSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";
import { writeJsonAtomic } from "./persistence";
import { featuresFor, includedCommand } from "../src/shared/edition";
import { currentEdition } from "./edition";

// The app runs Agy with its own home folder, so these rules never change the user's own Agy settings.
// Tested 2026-10-25: `--sandbox` blocks shell writes outside the workspace but not Agy's file tools;
// `read_file(path)` / `write_file(path)` deny rules block file tools, and deny beats allow, so the rules
// name every file and folder *around* the workspace instead of denying a parent.

// Pipeline steps run only through `sensei`. These are the detours Agy took when it lost its skill (npm instead of
// sensei, curl against job sites, find/which to hunt for the app); denying them makes it stop and report instead.
const COMMAND_DENIES = ["command(python3)", "command(python)", "command(node)", "command(python3 -c)", "command(python -c)", "command(npm)", "command(npx)", "command(curl)", "command(wget)", "command(find)", "command(which)", "command(pip)", "command(pip3)"];
const SETTINGS = [".gemini", "antigravity-cli", "settings.json"] as const;
const GENERATED = [".gemini", "antigravity-cli", "jobsensei-rules.json"] as const;

export function agyHomePath(userDataPath: string): string {
  return join(userDataPath, "agy-home");
}

/**
 * Recruiter Edition (recruiter plan R2, changed 2026-11-11): one Agy home and one sign-in for the recruiter, used for
 * every candidate, so Agy's first-run screens and terms happen once. What must not cross between candidates is Agy's
 * history (conversations, memory, summaries, prompt history). Those entries are kept per candidate under
 * `userData/agy-history/<candidate-id>/` and swapped into the shared home when that candidate opens, while Agy is
 * stopped. Everything else in the home (sign-in, settings, first-run state, Agy's own program files) stays shared.
 */
export const AGY_HISTORY_ENTRIES = [
  "antigravity-cli/conversations", "antigravity-cli/brain", "antigravity-cli/implicit", "antigravity-cli/annotations",
  "antigravity-cli/conversation_summaries.db", "antigravity-cli/conversation_summaries.db-shm", "antigravity-cli/conversation_summaries.db-wal",
  "antigravity-cli/history.jsonl", "antigravity-cli/jetbox_summaries_proto.pb", "config/projects",
  // Found in a live run (2026-11-11): two cache files keep conversation titles and first prompts, and the logs keep
  // prompts. The rest of the cache stays shared: `cache/onboarding.json` records that Agy's first run is done.
  "antigravity-cli/cache/conversation_metadata.json", "antigravity-cli/cache/last_conversations.json", "antigravity-cli/log", "antigravity-cli/cli.log",
  // The app's record of its background conversations (pruneHeadlessConversations) belongs with those conversations.
  "antigravity-cli/jobsensei-headless.json",
] as const;
const HISTORY_OWNER = [".gemini", "antigravity-cli", "jobsensei-history-owner"] as const;
/** History found in the shared home with no recorded owner is set aside here, never given to a candidate. */
const UNOWNED = "_unowned";

export function agyHistoryRoot(userDataPath: string): string {
  return join(userDataPath, "agy-history");
}

export function candidateHistoryPath(userDataPath: string, candidateId: string): string {
  if (candidateId !== UNOWNED && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidateId)) throw new Error("Invalid candidate history.");
  return join(agyHistoryRoot(userDataPath), candidateId);
}

async function moveEntries(fromRoot: string, toRoot: string): Promise<void> {
  for (const entry of AGY_HISTORY_ENTRIES) {
    const from = join(fromRoot, ...entry.split("/"));
    if (!(await lstat(from).catch(() => null))) continue;
    const to = join(toRoot, ...entry.split("/"));
    await rm(to, { recursive: true, force: true });
    await mkdir(dirname(to), { recursive: true });
    await renameWhenFree(from, to);
  }
}

/**
 * Windows locks a file while any process has it open, so a rename right after Agy closes can fail for a moment
 * (EBUSY/EPERM/EACCES) while its helper processes let go. Retries for up to ~6 s before giving up (2026-11-14).
 */
export async function renameWhenFree(from: string, to: string, attempts = 12, waitMs = 500): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try { await rename(from, to); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !["EBUSY", "EPERM", "EACCES"].includes(code ?? "")) throw error;
      await new Promise((done) => setTimeout(done, waitMs));
    }
  }
}

/**
 * Makes the shared home hold only `candidateId`'s Agy history. Call only while Agy is stopped (opening a candidate
 * stops it). The previous owner's history goes back to their store; history with no owner is set aside.
 */
export async function useCandidateHistory(userDataPath: string, candidateId: string): Promise<void> {
  const home = join(agyHomePath(userDataPath), ".gemini");
  const ownerFile = join(agyHomePath(userDataPath), ...HISTORY_OWNER);
  const owner = (await readFile(ownerFile, "utf8").catch(() => "")).trim();
  if (owner === candidateId) return;
  await moveEntries(home, candidateHistoryPath(userDataPath, owner || UNOWNED));
  await moveEntries(candidateHistoryPath(userDataPath, candidateId), home);
  await mkdir(dirname(ownerFile), { recursive: true });
  await writeFile(ownerFile, `${candidateId}\n`);
}

/** Removes a candidate's Agy history (deleting the candidate). Clears the shared home too when it holds theirs. */
export async function removeCandidateHistory(userDataPath: string, candidateId: string): Promise<void> {
  await rm(candidateHistoryPath(userDataPath, candidateId), { recursive: true, force: true });
  const ownerFile = join(agyHomePath(userDataPath), ...HISTORY_OWNER);
  if ((await readFile(ownerFile, "utf8").catch(() => "")).trim() !== candidateId) return;
  for (const entry of AGY_HISTORY_ENTRIES) await rm(join(agyHomePath(userDataPath), ".gemini", ...entry.split("/")), { recursive: true, force: true });
  await rm(ownerFile, { force: true });
}

function realPath(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

/**
 * Agy loads `.agents/` and `AGENTS.md` from every folder between the workspace and its project (git) root.
 * Those paths stay readable (never writable) so a workspace nested in a checkout can still load its skills.
 */
export function agentPathsAbove(workspacePath: string): string[] {
  const workspace = realPath(workspacePath);
  const parents: string[] = [];
  for (let current = dirname(workspace); current !== dirname(current); current = dirname(current)) {
    parents.push(current);
    if (existsSync(join(current, ".git"))) {
      return parents.flatMap((parent) => [join(parent, ".agents"), join(parent, "AGENTS.md")]);
    }
  }
  return []; // not inside a git project: Agy's project root is the workspace itself
}

/**
 * System folders stay open: Agy's `--sandbox` turns read_file denies into its sandbox profile, so denying
 * /bin or /usr stopped every sandboxed command from starting a shell (Agy then asked to bypass the sandbox).
 */
const SYSTEM_PATHS = new Set(["/Applications", "/Library", "/System", "/bin", "/cores", "/dev", "/etc", "/opt", "/private", "/private/etc", "/private/tmp", "/private/var", "/sbin", "/tmp", "/usr", "/var"]);

/** True when `path` is `target` or one of its ancestors. */
function covers(path: string, target: string): boolean {
  return target === path || target.startsWith(`${path}${sep}`);
}

/**
 * Deny rules for every sibling of every folder on the way from the filesystem root down to the workspace
 * (and each extra path). `readable` paths, at any depth, are opened for reading only: they get a write_file rule,
 * the siblings on the way to them are denied the same way, and the folders above them get no rule.
 * The caller also lists them as read_file allow rules, without which the sandbox can't read them.
 */
export function boundaryDenyRules(workspacePath: string, extraPaths: string[] = [], readable: string[] = []): string[] {
  const full = [workspacePath, ...extraPaths].map(realPath);
  // A readable path inside another one adds nothing (the outer path's write rule already covers it).
  const nested = (path: string, others: string[]) => others.some((other) => other !== path && covers(other, path));
  const readOnly = [...new Set(readable.map(realPath))].filter((path, _index, all) => !nested(path, all));
  const rules: string[] = readOnly.map((path) => `write_file(${path})`);
  for (const target of [...full, ...readOnly]) {
    const root = parse(target).root;
    const parts = target.slice(root.length).split(sep).filter(Boolean);
    let current = root;
    for (const part of parts) {
      let entries: string[] = [];
      try { entries = readdirSync(current); } catch { entries = []; }
      for (const entry of entries) {
        if (entry === part) continue;
        const path = join(current, entry);
        rules.push(`read_file(${path})`, `write_file(${path})`);
      }
      current = join(current, part);
    }
  }
  // Deny beats allow, so a rule on an allowed path or one of its ancestors would block it.
  return [...new Set(rules)].filter((rule) => {
    const path = rule.slice(rule.indexOf("(") + 1, -1);
    if (process.platform !== "win32" && SYSTEM_PATHS.has(path)) return false;
    if (full.some((target) => covers(path, target))) return false;
    // Tested 2026-10-26: any deny on a folder above a readable path also stops the sandbox reading it.
    if (readOnly.includes(path)) return rule.startsWith("write_file(");
    return !readOnly.some((target) => covers(path, target));
  });
}

/**
 * What the `sensei` command reads when it runs inside Agy's sandbox: the launcher itself, the app runtime, and
 * (from a source checkout) the compiled scripts and their dependencies.
 */
export function launcherReadPaths(home: string, launcher: { appRoot: string; runtimePath: string }): string[] {
  const bundle = /^(.*?\.app)(?:[\\/]|$)/.exec(launcher.runtimePath)?.[1] ?? dirname(launcher.runtimePath);
  // Node reads the nearest package.json to load a compiled script.
  return [join(home, "bin"), bundle, join(launcher.appRoot, "dist-electron"), join(launcher.appRoot, "node_modules"), join(launcher.appRoot, "package.json")];
}

/**
 * macOS: Agy saves its sign-in in the login keychain under $HOME/Library/Keychains. The app-owned home has none,
 * so macOS asks for a keychain on every start. Links it to the user's keychains once; returns the link path.
 */
export async function linkKeychains(home: string, userHome = homedir(), platform = process.platform): Promise<string | null> {
  if (platform !== "darwin") return null;
  const link = join(home, "Library", "Keychains");
  const target = join(userHome, "Library", "Keychains");
  const existing = await lstat(link).catch(() => null);
  if (existing) {
    // Leave a correct link alone; never replace a real folder or a link someone pointed elsewhere.
    if (!existing.isSymbolicLink() || await readlink(link) !== target) console.warn(`Agy keychain path is not the expected link: ${link}`);
    return link;
  }
  await mkdir(dirname(link), { recursive: true });
  await symlink(target, link);
  return link;
}

type AgySettings = { permissions?: { allow?: string[]; deny?: string[] }; [key: string]: unknown };

/**
 * Writes the app-owned Agy settings for this workspace and returns the home folder to launch Agy with.
 * Keeps the user's own choices in that file (model, allowed commands); replaces only the rules this app added last time.
 */
// One preparation at a time: the terminal start and a background run can both prepare the home, and two history
// swaps at once scrambled whose history was where (found live 2026-11-11).
let preparing: Promise<unknown> = Promise.resolve();

export function prepareAgyHome(userDataPath: string, workspacePath: string, extraPaths: string[] = [], launcher?: { appRoot: string; runtimePath: string }, candidateId?: string): Promise<string> {
  const next = preparing.catch(() => undefined).then(() => prepareAgyHomeNow(userDataPath, workspacePath, extraPaths, launcher, candidateId));
  preparing = next;
  return next;
}

async function prepareAgyHomeNow(userDataPath: string, workspacePath: string, extraPaths: string[], launcher: { appRoot: string; runtimePath: string } | undefined, candidateId: string | undefined): Promise<string> {
  // The Recruiter Edition shares one home and swaps in the open candidate's Agy history (useCandidateHistory).
  const home = agyHomePath(userDataPath);
  if (candidateId) await useCandidateHistory(userDataPath, candidateId);
  const settingsPath = join(home, ...SETTINGS);
  const generatedPath = join(home, ...GENERATED);
  await mkdir(dirname(settingsPath), { recursive: true });
  const current = JSON.parse(await readFile(settingsPath, "utf8").catch(() => "{}")) as AgySettings;
  const previous = new Set(JSON.parse(await readFile(generatedPath, "utf8").catch(() => "[]")) as string[]);
  const keychains = await linkKeychains(home);
  // Agy's file tools never touch the keychains, through the link or directly.
  const keychainDenies = keychains ? [keychains, join(homedir(), "Library", "Keychains")].flatMap((path) => [`read_file(${path})`, `write_file(${path})`]) : [];
  // Other candidates' stored Agy history is never readable by Agy.
  const historyDenies = candidateId ? [`read_file(${agyHistoryRoot(userDataPath)})`, `write_file(${agyHistoryRoot(userDataPath)})`] : [];
  const agentPaths = agentPathsAbove(workspacePath);
  const readable = [...agentPaths, ...(launcher ? launcherReadPaths(home, launcher) : [])];
  const generated = [...new Set([...boundaryDenyRules(workspacePath, extraPaths, readable), ...keychainDenies, ...historyDenies, ...COMMAND_DENIES])];
  // Reads outside the workspace ask first in proceed-in-sandbox mode, and the sandbox can't read them at all
  // unless allowed; these reads are expected, so allow them.
  const generatedAllow = readable.map((path) => `read_file(${path})`);
  const keptDeny = (current.permissions?.deny ?? []).filter((rule) => !previous.has(rule));
  const keptAllow = (current.permissions?.allow ?? []).filter((rule) => !previous.has(rule));
  const next: AgySettings = {
    ...current,
    // The app opens Agy only in this workspace, so it is trusted up front (the trust question would block the queue).
    trustedWorkspaces: [...new Set([...((current.trustedWorkspaces as string[] | undefined) ?? []), realPath(workspacePath)])],
    // proceed-in-sandbox was tried 2026-10-26: Agy's sandbox can't write in the workspace, so every writing
    // `sensei` step asked for approval. Unattended runs need always-proceed.
    toolPermission: "always-proceed",
    artifactReviewPolicy: "always-proceed",
    permissions: { ...current.permissions, allow: [...new Set([...keptAllow, ...generatedAllow])], deny: [...new Set([...keptDeny, ...generated])] },
  };
  await writeJsonAtomic(settingsPath, next);
  await writeJsonAtomic(generatedPath, [...generated, ...generatedAllow]);
  return home;
}

/** Pipeline commands Agy may run: npm script name → compiled file, read from package.json (the only owner). */
export function pipelineScripts(packageJson: { scripts?: Record<string, string> }): Record<string, string> {
  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    const match = /\bnode (dist-electron\/electron\/[\w.-]+\.js)\s*$/.exec(command);
    if (match) scripts[name] = match[1]!;
  }
  return scripts;
}

/**
 * Writes the `sensei` command into the Agy home's bin folder. It runs each compiled script with the app's own
 * runtime, in the installed app and in a source checkout alike (`npm run dev` compiles first), so nothing is
 * compiled into the checkout from inside Agy's sandbox. A checkout without a compiled file falls back to its
 * npm script. Returns the bin folder to put first on PATH.
 */
export async function writeSenseiLauncher(home: string, options: { appRoot: string; packaged: boolean; runtimePath: string }): Promise<string> {
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true });
  // The build writes the command list (scripts/write-pipeline-scripts.mjs); a source checkout can fall back to package.json.
  const built = await readFile(join(options.appRoot, "dist-electron", "pipeline-scripts.json"), "utf8").then((raw) => JSON.parse(raw) as Record<string, string>).catch(() => null);
  const all = built && Object.keys(built).length ? built
    : pipelineScripts(JSON.parse(await readFile(join(options.appRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> });
  // Only this edition's commands (the build already filters; a source checkout filters here).
  const features = featuresFor(currentEdition());
  const scripts = Object.fromEntries(Object.entries(all).filter(([name]) => includedCommand(features, name)));
  const names = Object.keys(scripts).join(", ");
  const usage = `Usage: sensei <command> [args]. Commands: ${names}`;
  const compiled = (file: string) => options.packaged || existsSync(join(options.appRoot, file));
  if (process.platform === "win32") {
    const lines = ["@echo off", "setlocal", `if "%~1"=="" (echo ${usage} & exit /b 1)`];
    for (const name of Object.keys(scripts)) lines.push(`if "%~1"=="${name}" (shift & goto :${name.replace(/:/g, "_")})`);
    lines.push(`echo Unknown command "%~1". ${usage} & exit /b 1`);
    for (const [name, file] of Object.entries(scripts)) {
      lines.push(`:${name.replace(/:/g, "_")}`, "set ARGS=", ":collect_" + name.replace(/:/g, "_"), `if "%~1"=="" goto run_${name.replace(/:/g, "_")}`, "set ARGS=%ARGS% %1", "shift", `goto collect_${name.replace(/:/g, "_")}`, `:run_${name.replace(/:/g, "_")}`,
        compiled(file) ? `set ELECTRON_RUN_AS_NODE=1& "${options.runtimePath}" "${join(options.appRoot, file)}" %ARGS%` : `npm --prefix "${options.appRoot}" run -s ${name} -- %ARGS%`, "exit /b %ERRORLEVEL%");
    }
    await writeFile(join(bin, "sensei.cmd"), `${lines.join("\r\n")}\r\n`);
  } else {
    const cases = Object.entries(scripts).map(([name, file]) => compiled(file)
      ? `  ${name}) shift; ELECTRON_RUN_AS_NODE=1 exec "${options.runtimePath}" "${join(options.appRoot, file)}" "$@" ;;`
      : `  ${name}) shift; exec npm --prefix "${options.appRoot}" run -s ${name} -- "$@" ;;`);
    const script = ["#!/bin/sh", "# Written by JobSensei at each Agy start. Runs one pipeline command.", 'case "$1" in', ...cases, `  *) echo "${usage}" >&2; exit 1 ;;`, "esac", ""].join("\n");
    await writeFile(join(bin, "sensei"), script, { mode: 0o755 });
    await chmod(join(bin, "sensei"), 0o755);
  }
  return bin;
}

/**
 * Agy homes for background runs, prepared once per workspace (keyed by its resolved path, so switching workspaces
 * never reuses another workspace's home). A failed preparation isn't kept, so the next run tries again.
 */
export function createAgyHomeCache(prepare: (workspace: string) => Promise<string>) {
  const homes = new Map<string, Promise<string>>();
  return {
    get(workspace: string): Promise<string> {
      const key = resolve(workspace);
      if (!homes.has(key)) homes.set(key, prepare(workspace).catch((error) => { homes.delete(key); throw error; }));
      return homes.get(key)!;
    },
    /** A home the terminal start just prepared for this workspace. */
    set(workspace: string, home: string): void { homes.set(resolve(workspace), Promise.resolve(home)); },
  };
}

// ---------- Conversations the app starts (written answers, search, rating) ----------

/** Inside Agy's own folder and listed in AGY_HISTORY_ENTRIES, so in the Recruiter Edition it moves with each candidate's history. */
const HEADLESS_LEDGER = join(".gemini", "antigravity-cli", "jobsensei-headless.json");
type HeadlessLedger = { conversations: Record<string, string> };

async function readHeadlessLedger(agyHome: string): Promise<HeadlessLedger> {
  try {
    const parsed = JSON.parse(await readFile(join(agyHome, HEADLESS_LEDGER), "utf8")) as Partial<HeadlessLedger>;
    return { conversations: parsed.conversations && typeof parsed.conversations === "object" ? parsed.conversations : {} };
  } catch { return { conversations: {} }; }
}

/** Notes a conversation a headless run used, with when it was last used (the question agent reuses one per job). */
export async function recordHeadlessConversation(agyHome: string, id: string, now = new Date()): Promise<void> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return;
  const ledger = await readHeadlessLedger(agyHome);
  ledger.conversations[id] = now.toISOString();
  await mkdir(dirname(join(agyHome, HEADLESS_LEDGER)), { recursive: true });
  await writeFile(join(agyHome, HEADLESS_LEDGER), JSON.stringify(ledger), "utf8");
}

const conversationFiles = (agyHome: string, id: string) => {
  const cli = join(agyHome, ".gemini", "antigravity-cli");
  return [join(cli, "conversations", `${id}.db`), join(cli, "conversations", `${id}.db-shm`), join(cli, "conversations", `${id}.db-wal`), join(cli, "annotations", `${id}.pbtxt`), join(cli, "brain", id)];
};

/**
 * Deletes conversations the app's headless runs started, once they are older than `olderThanDays` and beyond the
 * newest `keep`. Only recorded IDs are touched, so the terminal's own conversations stay. Returns the IDs removed.
 */
export async function pruneHeadlessConversations(agyHome: string, options: { olderThanDays?: number; keep?: number; now?: Date } = {}): Promise<string[]> {
  const { olderThanDays = 14, keep = 20, now = new Date() } = options;
  const ledger = await readHeadlessLedger(agyHome);
  const byNewest = Object.entries(ledger.conversations).sort((a, b) => b[1].localeCompare(a[1]));
  const cutoff = now.getTime() - olderThanDays * 86_400_000;
  const old = byNewest.slice(keep).filter(([, usedAt]) => Date.parse(usedAt) < cutoff).map(([id]) => id);
  for (const id of old) {
    for (const path of conversationFiles(agyHome, id)) await rm(path, { recursive: true, force: true });
    delete ledger.conversations[id];
  }
  if (old.length) await writeFile(join(agyHome, HEADLESS_LEDGER), JSON.stringify(ledger), "utf8");
  return old;
}
