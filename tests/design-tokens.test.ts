import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// tokens.css owns every colour, size, and font (U2). These checks keep the renderer on it.
const dir = join(__dirname, "..", "src", "renderer");
const files = readdirSync(dir).filter((name) => /\.(css|tsx)$/.test(name)).map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
const css = files.filter((file) => file.name.endsWith(".css"));
const defined = new Set(files.flatMap((file) => [...file.text.matchAll(/(--[\w-]+)["']?\s*:/g)].map((match) => match[1])));

describe("design tokens", () => {
  it("every CSS variable the renderer uses is defined", () => {
    const missing = files.flatMap((file) => [...file.text.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]).filter((name) => !defined.has(name)).map((name) => `${file.name}: ${name}`));
    expect([...new Set(missing)]).toEqual([]);
  });
  it("no var() hides an undefined token behind a fallback", () => {
    const fallbacks = files.flatMap((file) => [...file.text.matchAll(/var\((--[\w-]+),/g)].map((match) => `${file.name}: ${match[1]}`));
    expect(fallbacks).toEqual([]);
  });
  it("labels are sentence case, never all caps", () => {
    expect(css.filter((file) => /text-transform:\s*uppercase/.test(file.text)).map((file) => file.name)).toEqual([]);
  });
  it("overlays use the scrim token, not a hardcoded dark colour", () => {
    const overlay = css.flatMap((file) => [...file.text.matchAll(/\.(?:search|settings)-overlay\s*\{[^}]*\}/g)].map((match) => match[0]));
    expect(overlay.length).toBeGreaterThan(0);
    for (const rule of overlay.filter((text) => /background/.test(text))) expect(rule).toContain("var(--scrim)");
  });
  it("the removed jobs board leaves no styles behind", () => {
    expect(css.filter((file) => /\.board[\s.{:-]/.test(file.text)).map((file) => file.name)).toEqual([]);
  });
});
