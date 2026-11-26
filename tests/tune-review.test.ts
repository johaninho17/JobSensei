// #118 (ledger U76): the Tune review is the one way to update content from new files. Source-text checks, like the
// other renderer tests; the engine's behaviour (top five, bank, declined, Undo) is tested in tune-runner.test.ts.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(path, "utf8");

describe("Tune review (#118)", () => {
  it("shows the engine's top five with checkboxes, Apply, Never suggest, and Undo", async () => {
    const panel = await read("src/renderer/TunePanel.tsx");
    expect(panel).toContain("window.sensei.tune.view(area)");
    expect(panel).toContain('type="checkbox"');
    expect(panel).toContain("window.sensei.tune.apply(area, [...checked], [])");
    expect(panel).toContain("window.sensei.tune.apply(area, [], [id])");
    expect(panel).toContain("Never suggest");
    expect(panel).toContain("window.sensei.tune.undo()");
    expect(panel).toContain("saved for later");
  });

  it("reads new recordings in Your content, and Profile has no Tune tab (#199)", async () => {
    const interviews = await read("src/renderer/InterviewsHome.tsx");
    expect(interviews).toMatch(/<TunePanel[\s\S]{0,200}area="interviews"/);
    expect(interviews).not.toContain("content.startUpdate");
    expect(interviews).not.toMatch(/Update from \$\{plural/);
    const app = await read("src/renderer/App.tsx");
    expect(app).not.toContain("TunePanel");
    expect(await read("src/renderer/SetupAndContext.tsx")).not.toContain('label: "Tune"');
    expect(await read("src/renderer/TunePanel.tsx")).not.toMatch(/["`>][^"`<]*\bTune\b/);
    expect(await read("electron/preload.ts")).not.toContain("content:start-update");
  });
});
