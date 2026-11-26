import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #21: the posting, the evaluation, and job files open inside the job page, so its header and tabs stay visible.
describe("job documents open inside the job page (#21)", () => {
  const source = readFileSync("src/renderer/JobWorkspace.tsx", "utf8");
  it("the posting is the Application tab's Posting subtab (no second Job posting button, U82); the evaluation link switches the subtab", () => {
    expect(source).not.toContain(">Job posting</button>");
    expect(source).toContain(`onClick={() => openAppView("evaluation")}>evaluation</button>`);
    expect(source).not.toMatch(/onSelect\((?:jobDescription|evaluation)\.relativePath\)/);
    expect(source).toContain(`{ id: "posting", label: "Posting", disabled: !jobDescription }`);
  });
  it("the Files tab previews a file below its list, with a way to the full view", () => {
    const files = source.slice(source.indexOf("function FilesTab"), source.indexOf("function RolePanel"));
    expect(files).toContain("onSelect={setOpenPath}");
    expect(files).toContain("<DocInline path={open}");
    expect(files).toContain("Open full view");
  });
});
