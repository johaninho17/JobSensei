import { existsSync, readdirSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
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
export async function prepareAgyHome(userDataPath: string, workspacePath: string, extraPaths: string[] = [], launcher?: { appRoot: string; runtimePath: string }): Promise<string> {
  const home = agyHomePath(userDataPath);
  const settingsPath = join(home, ...SETTINGS);
  const generatedPath = join(home, ...GENERATED);
  await mkdir(dirname(settingsPath), { recursive: true });
  const current = JSON.parse(await readFile(settingsPath, "utf8").catch(() => "{}")) as AgySettings;
  const previous = new Set(JSON.parse(await readFile(generatedPath, "utf8").catch(() => "[]")) as string[]);
  const keychains = await linkKeychains(home);
  // Agy's file tools never touch the keychains, through the link or directly.
  const keychainDenies = keychains ? [keychains, join(homedir(), "Library", "Keychains")].flatMap((path) => [`read_file(${path})`, `write_file(${path})`]) : [];
  const agentPaths = agentPathsAbove(workspacePath);
  const readable = [...agentPaths, ...(launcher ? launcherReadPaths(home, launcher) : [])];
  const generated = [...new Set([...boundaryDenyRules(workspacePath, extraPaths, readable), ...keychainDenies, ...COMMAND_DENIES])];
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
