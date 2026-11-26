import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("framing flags (U74, #195)", () => {
  it("show one closed chip only while a line is undecided, and nothing once every line is kept or reverted", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const framing = page.slice(page.indexOf("function FramingLines"), page.indexOf("const STRETCH_LABEL"));
    expect(framing).toContain("if (!open.length) return null;");
    expect(framing).not.toContain("kept as written");
    expect(framing).not.toContain("framing-lines-note");
  });
});
