import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #21: the posting, the evaluation, and job files open inside the job page, so its header and tabs stay visible.
describe("job documents open inside the job page (#21)", () => {
  const source = readFileSync("src/renderer/JobWorkspace.tsx", "utf8");
  it("the posting is the job page's Posting tab (no second Job posting button, U82, U89); the evaluation link opens it in place", () => {
    expect(source).not.toContain(">Job posting</button>");
    expect(source).toContain(`onClick={() => openAppView("evaluation")}>evaluation</button>`);
    expect(source).not.toMatch(/onSelect\((?:jobDescription|evaluation)\.relativePath\)/);
    expect(source).toContain(`...(jobDescription ? [{ id: "posting", label: "Posting", tab: "application" as const, view: "posting" as const }] : [])`);
  });
  it("the Files tab previews a file below its list, with a way to the full view", () => {
    const files = source.slice(source.indexOf("function FilesTab"), source.indexOf("function RolePanel"));
    expect(files).toContain("onSelect={setOpenPath}");
    expect(files).toContain("<DocInline path={open}");
    expect(files).toContain("Open full view");
  });
});
