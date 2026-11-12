// Recruiter Edition (2026-11-12): a candidate's Agy starts in their own last conversation (`--continue`); the
// regular app never does, and the sandbox flag stays on macOS and Linux.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agyArgs } from "../electron/terminal";

describe("candidate conversations", () => {
  it("adds --continue only when the open candidate's conversation should resume", () => {
    expect(agyArgs(false, false)).toEqual(["--sandbox"]);
    expect(agyArgs(false, true)).toEqual(["--sandbox", "--continue"]);
    expect(agyArgs(true, true)).toEqual(["--continue"]);
  });

  it("resumes only for a candidate's folder", () => {
    const main = readFileSync("electron/main.ts", "utf8");
    expect(main).toContain("terminal.setContinueConversation(Boolean(agyHomeName));");
  });
});
