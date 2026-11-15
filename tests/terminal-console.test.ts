import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/renderer/TerminalPanel.tsx", "utf8");

describe("the Agy console", () => {
  it("draws Agy's screen as the pty sends it (no line-ending conversion), so typing never garbles redraws (#11)", () => {
    expect(panel).toContain("convertEol: false");
    expect(panel).not.toContain("convertEol: true");
  });

  it("takes its font and colours from tokens.css, not values of its own", () => {
    expect(panel).not.toMatch(/DM Mono/);
    const theme = panel.slice(panel.indexOf("function terminalTheme"), panel.indexOf("function terminalTheme") + 900);
    for (const name of ["--term-bg", "--term-ink", "--term-leaf"]) expect(theme).toContain(name);
    expect(panel).toContain('token("--font-mono"');
  });

  it("uses the shared paste limit for chat pastes", () => {
    expect(panel).toContain("looksLikePastedPosting(text)");
    expect(panel).not.toMatch(/text\.length > 250/);
  });
});
