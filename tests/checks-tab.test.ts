import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Checks shows document checks only (#28)", () => {
  it("the application check repeats no fit score, strengths, gaps, or fit credit", () => {
    const source = readFileSync("src/renderer/JobWorkspace.tsx", "utf8");
    const check = source.slice(source.indexOf("function ApplicationHealth"));
    const body = check.slice(0, check.indexOf("\n}\n"));
    for (const text of ["ratingHighlights", "ratingGaps", "Why this rating", "Fit credit", "job.rating"]) expect(body, text).not.toContain(text);
  });
});
