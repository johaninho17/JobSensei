import { beforeAll, describe, expect, it } from "vitest";

// The renderer sanitizes through DOMParser; in Node a pass-through stub is enough to read the HTML it builds.
beforeAll(() => {
  (globalThis as { DOMParser?: unknown }).DOMParser = class {
    parseFromString(value: string) { return { querySelectorAll: () => [], body: { innerHTML: value } }; }
  };
});

describe("markdownHtml", () => {
  it("renders pipe tables instead of raw | rows", async () => {
    const { markdownHtml } = await import("../src/renderer/markdown");
    const html = markdownHtml(["## Logistics", "| Item | Answer |", "| --- | --- |", "| Location | Portland, OR |", "| Notice | two weeks |", "", "After the table."].join("\n"));
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Item</th>");
    expect(html).toContain("<td>Portland, OR</td>");
    expect(html).not.toContain("| Item |");
    expect(html).toContain("<p>After the table.</p>");
  });

  it("in the reading view, turns sources into short links, IDs into a hover marker, and fit words into badges", async () => {
    const { markdownHtml } = await import("../src/renderer/markdown");
    const html = markdownHtml([
      "- Imports fixed for real customers (S1)",
      "- Uses `context:work:imports` for the claim",
      "- Analytics software (https://example.com/product, accessed 2026-10-25)",
      "- Pay $90k–$110k (source: original_jd.md)",
      "| Requirement | Fit | Evidence |",
      "| --- | --- | --- |",
      "| SQL | met | context:work:sql |",
      "| Location | ⚠ Fill in Settings → Interview Prep | |",
    ].join("\n"), [], { readable: true });
    expect(html).toContain('Imports fixed for real customers <span class="evid" title="S1"');
    expect(html).not.toMatch(/context:work:imports<|\(S1\)/);
    expect(html).toContain('<a class="src-link" href="https://example.com/product" title="https://example.com/product">source</a>');
    expect(html).not.toContain("accessed 2026-10-25");
    expect(html).toContain('<span class="src-link" title="From the job posting">posting</span>');
    expect(html).toContain('<span class="fit-chip is-met">met</span>');
    expect(html).toContain('<span class="warn-chip">⚠ Fill in Settings → Interview Prep</span>');
    // Markdown links keep their URL; a cell holding only a story ID becomes the marker.
    const words = markdownHtml("- [Tally Robot](https://example.com/tally): shelf robot\n| A | B |\n| --- | --- |\n| x | S1 |", [], { readable: true });
    expect(words).toContain('<a href="https://example.com/tally">Tally Robot</a>');
    expect(words).toContain('<td> <span class="evid" title="S1"');
    // Documents opened for editing keep the raw text.
    expect(markdownHtml("- Imports fixed (S1)")).toContain("Imports fixed (S1)");
  });
});
