// #214: Setup and Your content open files in the app's viewer, not Finder.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("open files in the app (#214)", () => {
  it("Setup and Your content never send the user to Finder", async () => {
    const setup = await readFile("src/renderer/SetupAndContext.tsx", "utf8");
    const content = await readFile("src/renderer/InterviewsHome.tsx", "utf8");
    const app = await readFile("src/renderer/App.tsx", "utf8");
    for (const gone of ["Show in {navigator.platform", "Open folder</button>", "Show the context folder"]) expect(setup, gone).not.toContain(gone);
    expect(content).not.toContain("files.reveal");
    expect(app).not.toContain('onReveal={(path) => void window.sensei.files.reveal(path)');
  });
});
