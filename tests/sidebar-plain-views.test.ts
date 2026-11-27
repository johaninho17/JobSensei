import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #227: the sidebar's job views are plain labels; only the Jobs row keeps a number (live applications).
describe("sidebar job views", () => {
  const app = readFileSync("src/renderer/App.tsx", "utf8");
  const views = app.slice(app.indexOf('id="side-jobs-views"'), app.indexOf("</ul>", app.indexOf('id="side-jobs-views"')));

  it("shows each view without a count", () => {
    expect(views).toContain("{view.label}");
    expect(views).not.toContain("side-count");
    expect(views).not.toContain("view.count}");
  });

  it("keeps the one Jobs count", () => {
    expect(app).toMatch(/side-label">Jobs<\/span>[\s\S]{0,200}liveApplicationCount\(jobs\)/);
  });
});
