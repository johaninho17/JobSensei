import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boundaryDenyRules, prepareAgyHome } from "../electron/agy-home";

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

  it("writes its own settings, keeps the user's choices, and replaces only its old rules", async () => {
    const { root, workspace } = await tree();
    const userData = join(root, "userdata");
    const settingsPath = join(userData, "agy-home", ".gemini", "antigravity-cli", "settings.json");
    const home = await prepareAgyHome(userData, workspace);
    expect(home).toBe(join(userData, "agy-home"));
    const first = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(first).toMatchObject({ toolPermission: "always-proceed", trustedWorkspaces: [workspace] });
    expect(first.permissions.deny).toContain("command(python3 -c)");
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

  it("runs compiled scripts with the app's own runtime in the installed app", async () => {
    const { writeSenseiLauncher } = await import("../electron/agy-home");
    if (process.platform === "win32") return;
    const home = await realpath(await mkdtemp(join(tmpdir(), "sensei-launcher-")));
    const bin = await writeSenseiLauncher(home, { appRoot: process.cwd(), packaged: true, runtimePath: "/Applications/JobSensei.app/Contents/MacOS/JobSensei" });
    const script = await readFile(join(bin, "sensei"), "utf8");
    expect(script).toContain(`jd:fetch) shift; ELECTRON_RUN_AS_NODE=1 exec "/Applications/JobSensei.app/Contents/MacOS/JobSensei" "${join(process.cwd(), "dist-electron/electron/jd-fetch.js")}" "$@" ;;`);
    const dev = await readFile(join(await writeSenseiLauncher(home, { appRoot: process.cwd(), packaged: false, runtimePath: "" }), "sensei"), "utf8");
    expect(dev).toContain(`jd:fetch) shift; exec npm --prefix "${process.cwd()}" run -s jd:fetch -- "$@" ;;`);
  });
});

describe("pipeline commands run without Electron", () => {
  it("only main-process files import electron at the top level", async () => {
    const { readdir } = await import("node:fs/promises");
    const allowed = new Set(["main.ts", "preload.ts", "pdf-export.ts"]);
    for (const file of (await readdir("electron")).filter((name) => name.endsWith(".ts") && !allowed.has(name))) {
      expect(await readFile(join("electron", file), "utf8"), file).not.toMatch(/^import [^;]* from "electron";/m);
    }
  });
});
