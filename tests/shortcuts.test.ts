import { describe, expect, it } from "vitest";
import { SECOND_PRESS_MS, goTarget, neighborJob, statusKeyAction } from "../src/shared/shortcuts";

const all = { today: true, jobSearch: true, interviews: true };

describe("safer shortcuts (#23)", () => {
  it("g s and g d open Job Search and Docs; letters for left-out pages do nothing", () => {
    expect(goTarget("s", all)).toBe("search-home");
    expect(goTarget("d", all)).toBe("docs-home");
    expect(goTarget("t", all)).toBe("today-home");
    expect(goTarget("s", { today: false, jobSearch: false, interviews: false })).toBeNull();
    expect(goTarget("i", { today: false, jobSearch: false, interviews: false })).toBeNull();
    expect(goTarget("x", all)).toBeNull();
    expect(goTarget("a", { ...all, agyPage: true })).toBe("agy-home");
    expect(goTarget("a", all)).toBeNull();
  });
  it("[ and ] follow the filtered Jobs list the user came from, else all jobs", () => {
    const allIds = ["a", "b", "c", "d", "e"];
    expect(neighborJob("c", 1, ["e", "c", "a"], allIds)).toBe("a");
    expect(neighborJob("c", -1, ["e", "c", "a"], allIds)).toBe("e");
    expect(neighborJob("a", 1, ["e", "c", "a"], allIds)).toBeNull();
    expect(neighborJob("b", 1, ["e", "c", "a"], allIds)).toBe("c");
  });
  it("no single key closes a job: 5 and 6 need a second press within the window; 1–4 act at once", () => {
    expect(statusKeyAction("2", null, 0)).toBe("set");
    expect(statusKeyAction("5", null, 0)).toBe("arm");
    expect(statusKeyAction("5", { key: "5", at: 0 }, 500)).toBe("set");
    expect(statusKeyAction("6", { key: "5", at: 0 }, 500)).toBe("arm");
    expect(statusKeyAction("5", { key: "5", at: 0 }, SECOND_PRESS_MS + 1)).toBe("arm");
  });
});

describe("renderer feature flags (found while building #23)", () => {
  it("every FEATURES use names its flag (Vite replaces only FEATURES.<name>; a bare FEATURES crashes at runtime)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const bare = readdirSync("src/renderer").filter((name) => /\.tsx?$/.test(name) && name !== "edition.d.ts")
      .flatMap((name) => readFileSync(`src/renderer/${name}`, "utf8").split("\n").map((line, index) => ({ name, index, line })))
      .filter(({ line }) => /\bFEATURES\b(?!\.)/.test(line.replace(/\/\/.*$/, "")))
      .map(({ name, index }) => `${name}:${index + 1}`);
    expect(bare).toEqual([]);
  });
});
