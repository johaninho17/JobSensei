import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentPathsAbove, boundaryDenyRules, createAgyHomeCache, linkKeychains, prepareAgyHome } from "../electron/agy-home";

async function tree() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sensei-agyhome-")));
  await mkdir(join(root, "home", "workspace", "jobs"), { recursive: true });
  await mkdir(join(root, "home", "Photos"), { recursive: true });
  await mkdir(join(root, "home", ".ssh"), { recursive: true });
  await writeFile(join(root, "home", "notes.txt"), "private");
  await mkdir(join(root, "other"), { recursive: true });
  return { root, workspace: join(root, "home", "workspace") };
}

describe("app-owned Agy home", () => {
  it("denies everything around the workspace but never the workspace or its parents", async () => {
    const { root, workspace } = await tree();
    const rules = boundaryDenyRules(workspace);
    for (const outside of ["home/Photos", "home/.ssh", "home/notes.txt", "other"]) {
      expect(rules).toContain(`read_file(${join(root, outside)})`);
      expect(rules).toContain(`write_file(${join(root, outside)})`);
    }
    for (const allowed of [workspace, join(workspace, "jobs"), join(root, "home"), root]) {
      expect(rules).not.toContain(`read_file(${allowed})`);
      expect(rules).not.toContain(`write_file(${allowed})`);
    }
  });

  it("lets Agy read, never write, .agents and AGENTS.md in each folder up to the project root", async () => {
    const { root } = await tree();
    // A workspace nested two levels inside a git checkout, like data/ inside the repo.
    const project = join(root, "home", "repo");
    const workspace = join(project, "nest", "data");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(join(workspace, "jobs"), { recursive: true });
    for (const folder of [project, join(project, "nest")]) {
      await mkdir(join(folder, ".agents", "skills"), { recursive: true });
      await writeFile(join(folder, "AGENTS.md"), "rules");
      await writeFile(join(folder, "secret.txt"), "private");
    }
    await mkdir(join(root, "home", ".agents"), { recursive: true }); // above the project root: stays denied
    const readable = agentPathsAbove(workspace);
    expect(readable.sort()).toEqual([join(project, ".agents"), join(project, "AGENTS.md"), join(project, "nest", ".agents"), join(project, "nest", "AGENTS.md")].sort());
    const rules = boundaryDenyRules(workspace, [], readable);
    for (const path of readable) {
      expect(rules).not.toContain(`read_file(${path})`);
      expect(rules).toContain(`write_file(${path})`);
    }
    for (const outside of ["home/repo/secret.txt", "home/repo/.git", "home/repo/nest/secret.txt", "home/.agents", "home/Photos"]) {
      expect(rules).toContain(`read_file(${join(root, outside)})`);
      expect(rules).toContain(`write_file(${join(root, outside)})`);
    }
    // Those reads are allowed up front, so proceed-in-sandbox mode does not stop to ask.
    const userData = join(root, "userdata");
    await prepareAgyHome(userData, workspace);
    const settings = JSON.parse(await readFile(join(userData, "agy-home", ".gemini", "antigravity-cli", "settings.json"), "utf8"));
    expect(settings.permissions.allow.sort()).toEqual(readable.map((path) => `read_file(${path})`).sort());
    // Outside any git project the workspace is the project root: nothing above it is opened.
    expect(agentPathsAbove(join(root, "home", "workspace"))).toEqual([]);
  });

  it("opens the sensei launcher, runtime and compiled scripts for reading, and leaves system folders open", async () => {
    const { root, workspace } = await tree();
    const { launcherReadPaths } = await import("../electron/agy-home");
    const appRoot = join(root, "app");
    const runtime = join(appRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
    await mkdir(dirname(runtime), { recursive: true });
    await mkdir(join(appRoot, "node_modules", "zod"), { recursive: true });
    await mkdir(join(appRoot, "dist-electron"), { recursive: true });
    await mkdir(join(appRoot, "src"), { recursive: true });
    await writeFile(join(appRoot, "package.json"), "{}");
    const home = join(root, "userdata", "agy-home");
    await mkdir(join(home, "bin"), { recursive: true });
    await mkdir(join(home, ".gemini"), { recursive: true });
    const readable = launcherReadPaths(home, { appRoot, runtimePath: runtime });
    expect(readable).toContain(join(appRoot, "node_modules", "electron", "dist", "Electron.app"));
    const rules = boundaryDenyRules(workspace, [], readable);
    for (const path of [join(home, "bin"), join(appRoot, "dist-electron"), join(appRoot, "node_modules"), join(appRoot, "package.json")]) {
      expect(rules).not.toContain(`read_file(${path})`);
      expect(rules).toContain(`write_file(${path})`);
    }
    // Nothing inside node_modules is denied (the bundle path is nested in it), and folders above stay rule-free,
    // because any deny on a parent also stops the sandbox reading below it.
    expect(rules.filter((rule) => rule.includes(join(appRoot, "node_modules") + "/"))).toEqual([]);
    for (const above of [appRoot, join(root, "userdata"), home]) expect(rules.filter((rule) => rule.endsWith(`(${above})`))).toEqual([]);
    for (const outside of [join(appRoot, "src"), join(home, ".gemini")]) expect(rules).toContain(`read_file(${outside})`);
    if (process.platform !== "win32") for (const system of ["/bin", "/usr", "/System", "/Library", "/private/var"]) expect(rules.some((rule) => rule.endsWith(`(${system})`))).toBe(false);
    // The sandbox reads them only when they are also allowed.
    await prepareAgyHome(join(root, "userdata"), workspace, [], { appRoot, runtimePath: runtime });
    const settings = JSON.parse(await readFile(join(home, ".gemini", "antigravity-cli", "settings.json"), "utf8"));
    for (const path of readable) expect(settings.permissions.allow).toContain(`read_file(${path})`);
  });

  it("links the keychains once on macOS and denies them to Agy's file tools", async () => {
    const { root, workspace } = await tree();
    const home = join(root, "agy-home");
    const userHome = join(root, "user");
    expect(await linkKeychains(home, userHome, "win32")).toBeNull();
    const link = await linkKeychains(home, userHome, "darwin");
    expect(link).toBe(join(home, "Library", "Keychains"));
    expect((await lstat(link!)).isSymbolicLink()).toBe(true);
    expect(await readlink(link!)).toBe(join(userHome, "Library", "Keychains"));
    await linkKeychains(home, userHome, "darwin"); // an existing correct link is left alone
    expect(await readlink(link!)).toBe(join(userHome, "Library", "Keychains"));
    if (process.platform === "darwin") {
      const userData = join(root, "userdata");
      await prepareAgyHome(userData, workspace);
      const settings = JSON.parse(await readFile(join(userData, "agy-home", ".gemini", "antigravity-cli", "settings.json"), "utf8"));
      expect(settings.permissions.deny).toContain(`read_file(${join(userData, "agy-home", "Library", "Keychains")})`);
      expect(settings.permissions.deny).toContain(`write_file(${join(userData, "agy-home", "Library", "Keychains")})`);
    }
  });

  it("writes its own settings, keeps the user's choices, and replaces only its old rules", async () => {
    const { root, workspace } = await tree();
    const userData = join(root, "userdata");
    const settingsPath = join(userData, "agy-home", ".gemini", "antigravity-cli", "settings.json");
    const home = await prepareAgyHome(userData, workspace);
    expect(home).toBe(join(userData, "agy-home"));
    const first = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(first).toMatchObject({ toolPermission: "always-proceed", trustedWorkspaces: [workspace] });
    for (const detour of ["command(python3 -c)", "command(npm)", "command(curl)", "command(find)"]) expect(first.permissions.deny).toContain(detour);
    // The user adds a model and their own rules; the workspace moves.
    first.model = "Gemini Flash";
    first.permissions.allow.push("command(git status)");
    first.permissions.deny.push("command(curl)");
    await writeFile(settingsPath, JSON.stringify(first));
    await mkdir(join(root, "elsewhere", "ws2"), { recursive: true });
    await prepareAgyHome(userData, join(root, "elsewhere", "ws2"));
    const second = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(second.model).toBe("Gemini Flash");
    expect(second.permissions.allow).toContain("command(git status)");
    expect(second.permissions.deny).toContain("command(curl)");
    expect(second.permissions.deny).toContain(`read_file(${join(root, "home")})`);
    expect(second.permissions.deny).not.toContain(`read_file(${join(root, "elsewhere")})`);
  });
});

describe("sensei launcher", () => {
  it("maps every pipeline npm script and Agy instructions use only sensei", async () => {
    const { pipelineScripts } = await import("../electron/agy-home");
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    const scripts = pipelineScripts(pkg);
    expect(Object.keys(scripts).sort()).toEqual(["application:finalize", "application:validate", "context:snapshot", "interview:check", "interview:context", "jd:fetch"]);
    const { readdir } = await import("node:fs/promises");
    const walk = async (dir: string): Promise<string[]> => (await readdir(dir, { withFileTypes: true })).flatMap((e) => e.isDirectory() ? [] : [join(dir, e.name)]).concat(...await Promise.all((await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => walk(join(dir, e.name)))));
    for (const file of ["AGENTS.md", ...(await walk(".agents")).filter((f) => f.endsWith(".md"))]) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(/npm (?:--prefix|run)|JOBSENSEI_APP_ROOT/);
      expect(text, file).not.toMatch(/(?:jd:fetch|context:snapshot|application:finalize|interview:check|interview:context) -- /);
    }
  });

  it("runs compiled scripts with the app's own runtime, and npm only when a checkout has no compiled file", async () => {
    const { writeSenseiLauncher } = await import("../electron/agy-home");
    if (process.platform === "win32") return;
    const home = await realpath(await mkdtemp(join(tmpdir(), "sensei-launcher-")));
    const bin = await writeSenseiLauncher(home, { appRoot: process.cwd(), packaged: true, runtimePath: "/Applications/JobSensei.app/Contents/MacOS/JobSensei" });
    const script = await readFile(join(bin, "sensei"), "utf8");
    expect(script).toContain(`jd:fetch) shift; ELECTRON_RUN_AS_NODE=1 exec "/Applications/JobSensei.app/Contents/MacOS/JobSensei" "${join(process.cwd(), "dist-electron/electron/jd-fetch.js")}" "$@" ;;`);
    // A source checkout: a compiled file runs directly; a missing one falls back to npm (which compiles first).
    const checkout = join(home, "checkout");
    await mkdir(join(checkout, "dist-electron", "electron"), { recursive: true });
    await writeFile(join(checkout, "package.json"), JSON.stringify({ scripts: { "jd:fetch": "tsc -p x && node dist-electron/electron/jd-fetch.js", "context:snapshot": "node dist-electron/electron/evidence-snapshot.js" } }));
    await writeFile(join(checkout, "dist-electron", "electron", "jd-fetch.js"), "");
    const dev = await readFile(join(await writeSenseiLauncher(home, { appRoot: checkout, packaged: false, runtimePath: "/dev/Electron" }), "sensei"), "utf8");
    expect(dev).toContain(`jd:fetch) shift; ELECTRON_RUN_AS_NODE=1 exec "/dev/Electron" "${join(checkout, "dist-electron/electron/jd-fetch.js")}" "$@" ;;`);
    expect(dev).toContain(`context:snapshot) shift; exec npm --prefix "${checkout}" run -s context:snapshot -- "$@" ;;`);
    await rm(home, { recursive: true, force: true });
  });
});

describe("pipeline commands run without Electron", () => {
  it("only main-process files import electron at the top level", async () => {
    const { readdir } = await import("node:fs/promises");
    // Feature IPC modules are loaded only by main.ts (src/shared/edition.ts); feature-context imports electron types only.
    const allowed = new Set(["main.ts", "preload.ts", "pdf-export.ts", "interview-ipc.ts", "question-ipc.ts", "content-ipc.ts", "search-ipc.ts", "today-ipc.ts", "candidate-ipc.ts", "feature-context.ts", "page-render.ts"]);
    for (const file of (await readdir("electron")).filter((name) => name.endsWith(".ts") && !allowed.has(name))) {
      expect(await readFile(join("electron", file), "utf8"), file).not.toMatch(/^import [^;]* from "electron";/m);
    }
  });
});

describe("Agy home cache for background runs", () => {
  it("prepares one home per workspace, never shares one across workspaces, and retries after a failure", async () => {
    const calls: string[] = [];
    let fail = true;
    const cache = createAgyHomeCache(async (workspace) => {
      calls.push(workspace);
      if (workspace.endsWith("broken") && fail) { fail = false; throw new Error("no home"); }
      return `${workspace}/.agy-home`;
    });
    expect(await cache.get("/w/alex")).toBe("/w/alex/.agy-home");
    expect(await cache.get("/w/alex/")).toBe("/w/alex/.agy-home");
    expect(await cache.get("/w/jordan")).toBe("/w/jordan/.agy-home");
    expect(calls).toEqual(["/w/alex", "/w/jordan"]);
    await expect(cache.get("/w/broken")).rejects.toThrow("no home");
    expect(await cache.get("/w/broken")).toBe("/w/broken/.agy-home");
    cache.set("/w/alex", "/fresh");
    expect(await cache.get("/w/alex")).toBe("/fresh");
  });
});
