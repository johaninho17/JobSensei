import { readdirSync, realpathSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { writeJsonAtomic } from "./persistence";

// The app runs Agy with its own home folder, so these rules never change the user's own Agy settings.
// Tested 2026-10-25: `--sandbox` blocks shell writes outside the workspace but not Agy's file tools;
// `read_file(path)` / `write_file(path)` deny rules block file tools, and deny beats allow, so the rules
// name every file and folder *around* the workspace instead of denying a parent.

const COMMAND_DENIES = ["command(python3)", "command(python)", "command(node -e)", "command(python3 -c)", "command(python -c)"];
const SETTINGS = [".gemini", "antigravity-cli", "settings.json"] as const;
const GENERATED = [".gemini", "antigravity-cli", "jobsensei-rules.json"] as const;

export function agyHomePath(userDataPath: string): string {
  return join(userDataPath, "agy-home");
}

function realPath(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

/** Deny rules for every sibling of every folder on the way from the filesystem root down to the workspace. */
export function boundaryDenyRules(workspacePath: string, extraPaths: string[] = []): string[] {
  const rules: string[] = [];
  for (const target of [workspacePath, ...extraPaths].map(realPath)) {
    const root = parse(target).root;
    const parts = target.slice(root.length).split(sep).filter(Boolean);
    let current = root;
    for (const part of parts) {
      let entries: string[] = [];
      try { entries = readdirSync(current); } catch { entries = []; }
      for (const entry of entries) {
        if (entry === part) continue;
        const full = join(current, entry);
        rules.push(`read_file(${full})`, `write_file(${full})`);
      }
      current = join(current, part);
    }
  }
  // A path that is an ancestor of an allowed folder must never be denied (deny beats allow).
  const allowed = [workspacePath, ...extraPaths].map(realPath);
  return [...new Set(rules)].filter((rule) => {
    const path = rule.slice(rule.indexOf("(") + 1, -1);
    return !allowed.some((keep) => keep === path || keep.startsWith(`${path}${sep}`));
  });
}

type AgySettings = { permissions?: { allow?: string[]; deny?: string[] }; [key: string]: unknown };

/**
 * Writes the app-owned Agy settings for this workspace and returns the home folder to launch Agy with.
 * Keeps the user's own choices in that file (model, allowed commands); replaces only the rules this app added last time.
 */
export async function prepareAgyHome(userDataPath: string, workspacePath: string, extraPaths: string[] = []): Promise<string> {
  const home = agyHomePath(userDataPath);
  const settingsPath = join(home, ...SETTINGS);
  const generatedPath = join(home, ...GENERATED);
  await mkdir(dirname(settingsPath), { recursive: true });
  const current = JSON.parse(await readFile(settingsPath, "utf8").catch(() => "{}")) as AgySettings;
  const previous = new Set(JSON.parse(await readFile(generatedPath, "utf8").catch(() => "[]")) as string[]);
  const generated = [...boundaryDenyRules(workspacePath, extraPaths), ...COMMAND_DENIES];
  const keptDeny = (current.permissions?.deny ?? []).filter((rule) => !previous.has(rule));
  const next: AgySettings = {
    ...current,
    // The app opens Agy only in this workspace, so it is trusted up front (the trust question would block the queue).
    trustedWorkspaces: [...new Set([...((current.trustedWorkspaces as string[] | undefined) ?? []), realPath(workspacePath)])],
    toolPermission: "always-proceed",
    artifactReviewPolicy: "always-proceed",
    permissions: { ...current.permissions, allow: current.permissions?.allow ?? [], deny: [...new Set([...keptDeny, ...generated])] },
  };
  await writeJsonAtomic(settingsPath, next);
  await writeJsonAtomic(generatedPath, generated);
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
 * Writes the `sensei` command into the Agy home's bin folder. From a source checkout it runs the npm script
 * (which compiles first); in the installed app it runs the compiled script with the app's own runtime,
 * because npm and TypeScript are not shipped. Returns the bin folder to put first on PATH.
 */
export async function writeSenseiLauncher(home: string, options: { appRoot: string; packaged: boolean; runtimePath: string }): Promise<string> {
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true });
  // The build writes the command list (scripts/write-pipeline-scripts.mjs); a source checkout can fall back to package.json.
  const built = await readFile(join(options.appRoot, "dist-electron", "pipeline-scripts.json"), "utf8").then((raw) => JSON.parse(raw) as Record<string, string>).catch(() => null);
  const scripts = built && Object.keys(built).length ? built
    : pipelineScripts(JSON.parse(await readFile(join(options.appRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> });
  const names = Object.keys(scripts).join(", ");
  const usage = `Usage: sensei <command> [args]. Commands: ${names}`;
  if (process.platform === "win32") {
    const lines = ["@echo off", "setlocal", `if "%~1"=="" (echo ${usage} & exit /b 1)`];
    for (const name of Object.keys(scripts)) lines.push(`if "%~1"=="${name}" (shift & goto :${name.replace(/:/g, "_")})`);
    lines.push(`echo Unknown command "%~1". ${usage} & exit /b 1`);
    for (const [name, file] of Object.entries(scripts)) {
      lines.push(`:${name.replace(/:/g, "_")}`, "set ARGS=", ":collect_" + name.replace(/:/g, "_"), `if "%~1"=="" goto run_${name.replace(/:/g, "_")}`, "set ARGS=%ARGS% %1", "shift", `goto collect_${name.replace(/:/g, "_")}`, `:run_${name.replace(/:/g, "_")}`,
        options.packaged ? `set ELECTRON_RUN_AS_NODE=1& "${options.runtimePath}" "${join(options.appRoot, file)}" %ARGS%` : `npm --prefix "${options.appRoot}" run -s ${name} -- %ARGS%`, "exit /b %ERRORLEVEL%");
    }
    await writeFile(join(bin, "sensei.cmd"), `${lines.join("\r\n")}\r\n`);
  } else {
    const cases = Object.entries(scripts).map(([name, file]) => options.packaged
      ? `  ${name}) shift; ELECTRON_RUN_AS_NODE=1 exec "${options.runtimePath}" "${join(options.appRoot, file)}" "$@" ;;`
      : `  ${name}) shift; exec npm --prefix "${options.appRoot}" run -s ${name} -- "$@" ;;`);
    const script = ["#!/bin/sh", "# Written by JobSensei at each Agy start. Runs one pipeline command.", 'case "$1" in', ...cases, `  *) echo "${usage}" >&2; exit 1 ;;`, "esac", ""].join("\n");
    await writeFile(join(bin, "sensei"), script, { mode: 0o755 });
    await chmod(join(bin, "sensei"), 0o755);
  }
  return bin;
}
