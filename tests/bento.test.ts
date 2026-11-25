// Bento pilot (ledger U77, #125): the new card surfaces keep WCAG AA in both themes, the hero is the brass one,
// the grid steps by container width, and depth stays inside Today's .bento-page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BentoCard, FitRing, Kpi, fitRingBand } from "../src/renderer/BentoPrimitives";

const renderer = (name: string) => readFileSync(join(__dirname, "..", "src", "renderer", name), "utf8");
const tokens = renderer("tokens.css");
const layout = renderer("layout.css");

function themeHexes(block: string) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [match[1], match[2]]));
}
const darkBlock = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf(":root[data-theme=\"light\"]"));
const lightBlock = tokens.slice(tokens.indexOf(":root[data-theme=\"light\"]"), tokens.indexOf("}", tokens.indexOf(":root[data-theme=\"light\"]")));
const dark = themeHexes(darkBlock);
const light = { ...dark, ...themeHexes(lightBlock) };

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("Bento tokens (#125)", () => {
  for (const [theme, values] of [["dark", dark], ["light", light]] as const) {
    it(`${theme}: text on the card and nested surfaces passes AA, rings and stripes pass 3:1`, () => {
      for (const surface of ["--raised", "--raised-nested"]) {
        expect(values[surface], `${theme} ${surface}`).toBeDefined();
        for (const text of ["--ink", "--muted", "--brass", "--accent"]) expect(contrast(values[text]!, values[surface]!), `${theme} ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        for (const mark of ["--leaf", "--risk", "--brass"]) expect(contrast(values[mark]!, values[surface]!), `${theme} ${mark} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(values["--on-accent"]!, values["--accent"]!), `${theme} button`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("defines the card shadows and specular edge in both themes, and leaves --canvas and --raised as they were", () => {
    for (const block of [darkBlock, lightBlock]) for (const name of ["--shadow-card", "--shadow-card-hover", "--specular-edge", "--raised-nested"]) expect(block).toContain(`${name}:`);
    expect(dark["--canvas"]).toBe("#181c1a");
    expect(light["--canvas"]).toBe("#f6f7f5");
    expect(light["--raised"]).toBe("#ffffff");
  });
});

describe("Bento layout (#125)", () => {
  it("steps 4 → 2 → 1 columns by the page's width, not the window's", () => {
    expect(layout).toMatch(/\.bento-page \{ container: bento \/ inline-size; \}/);
    expect(layout).toMatch(/\.bento \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(layout).toMatch(/@container bento \(max-width: 900px\) \{\s*\.bento \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(layout).toMatch(/@container bento \(max-width: 520px\) \{\s*\.bento \{ grid-template-columns: minmax\(0, 1fr\)/);
  });

  it("one shared surfaces block owns the card shadows, and covers every card template (U78)", () => {
    const users = [...`${layout}\n${renderer("styles.css")}`.matchAll(/([^{}]+)\{[^}]*var\(--(?:shadow-card|specular-edge)/g)].map((match) => match[1]!.trim());
    expect(users).toHaveLength(2);
    for (const template of [".bento-card", ".job-card", ".jobs-table-wrap", ".add-job", ".overview-panel", ".icard", ".bento-surface"]) expect(users[0]).toContain(template);
  });
});

describe("Bento primitives (#125)", () => {
  const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

  it("the hero has the brass edge and its title as the brass label", () => {
    const hero = html(createElement(BentoCard, { title: "Do this next", tone: "hero", children: "x" }));
    expect(hero).toContain('class="bento-card is-hero has-stripe stripe-brass"');
    expect(hero).toContain('<p class="bento-eyebrow">Do this next</p>');
    const plain = html(createElement(BentoCard, { title: "Due", stripe: "risk", span: 2, children: "x" }));
    expect(plain).toContain("stripe-risk span-2");
    expect(plain).toContain("<h2>Due</h2>");
  });

  it("a KPI shows its number, label, and one action", () => {
    const kpi = html(createElement(Kpi, { value: 3, label: "Interviews this week", actionLabel: "Open interviews", onAction: () => undefined }));
    expect(kpi).toContain(">3</p>");
    expect(kpi).toContain("Interviews this week");
    expect(kpi.match(/<button/g)).toHaveLength(1);
  });

  it("the fit ring uses the job bands and always says the fit in words", () => {
    expect([4.5, 3.2, 2, null].map(fitRingBand)).toEqual(["high", "mid", "low", "unrated"]);
    expect(html(createElement(FitRing, { rating: 4.2 }))).toContain('aria-label="Fit 4.2 of 5, strong fit"');
    expect(html(createElement(FitRing, { rating: null }))).toContain('aria-label="Fit not rated"');
  });
});
