// #117 (ledger U76): the Tune engine. What changed is found by hash, Agy's suggestions are checked and banked, only the
// picked ones are applied, with backup, Undo, and history; declined ones never return. Fictional candidate only.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyTuneSuggestion } from "../electron/tune-apply";
import { applyTune, changedSources, collectTune, startTune, tuneStatus, tuneView, undoTune } from "../electron/tune-runner";
import { TUNE_HISTORY_FILE, tuneSuggestionsFile, type TuneSuggestionInput } from "../src/shared/tune-schemas";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const STORY_BANK = "# Story bank\n\n## S1 · Import that kept failing\n- Situation: nightly import failed\n- Result: fixed\n\n## S2 · Runbooks\n- Wrote runbooks\n";
const VOICE = "# Interview voice\n\n## Phrases I use\n- honestly\n- synergy\n\n## Delivery fixes\n- Slow down — Now: rushed — Aim: calm\n";
const RECORDS = "# Work evidence\n\n## Evidence\n\n| Evidence ID | Year | Project | Explicit claim | Scope | Source | Confidence | Public use |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| context:work:runbooks | 2024 | Runbooks | Wrote runbooks | solo | notes | high | eligible |\n";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-tune-"));
  temps.push(root);
  const write = async (path: string, content: string) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); };
  await write("profile/story_bank.md", STORY_BANK);
  await write("profile/interview_voice.md", VOICE);
  await write("context/structured/work-evidence.md", RECORDS);
  await write("context/broad/northstar-notes.md", "Alex wrote 12 runbooks at Northstar Labs.\n");
  const read = (path: string) => readFile(join(root, path), "utf8");
  return { root, write, read };
}

const suggestion = (patch: Partial<TuneSuggestionInput>): TuneSuggestionInput => ({ operation: "add", file: "context/structured/work-evidence.md", section: "Evidence", reason: "from the notes", source: "context/broad/northstar-notes.md", urgency: 3, impact: 3, ...patch });

describe("applying one suggestion (#117)", () => {
  const base = { file: "profile/story_bank.md", section: "S2 · Runbooks" };
  it("adds a row after the table, a bullet under its section, and a story at the end", () => {
    const row = applyTuneSuggestion(RECORDS, { operation: "add", file: "context/structured/work-evidence.md", section: "Evidence", text: "| context:work:imports | 2025 | Imports | Kept imports running | team | notes | high | eligible |" });
    expect(row.ok && row.markdown.trimEnd().endsWith("| context:work:imports | 2025 | Imports | Kept imports running | team | notes | high | eligible |")).toBe(true);
    const bullet = applyTuneSuggestion(VOICE, { operation: "add", file: "profile/interview_voice.md", section: "Phrases I use", text: "to be fair" });
    expect(bullet.ok && bullet.markdown).toContain("- synergy\n- to be fair\n\n## Delivery fixes");
    const story = applyTuneSuggestion(STORY_BANK, { ...base, operation: "add", section: "S3 · New", text: "## S3 · New\n- Situation: x" });
    expect(story.ok && story.markdown.trimEnd().endsWith("## S3 · New\n- Situation: x")).toBe(true);
    expect(applyTuneSuggestion(VOICE, { operation: "add", file: "profile/interview_voice.md", section: "Phrases I use", text: "- honestly" }).ok).toBe(false);
  });

  it("replaces a story by ID and a bullet by its first words, keeping the old text", () => {
    const story = applyTuneSuggestion(STORY_BANK, { ...base, operation: "enrich", target: "S2", text: "## S2 · Runbooks\n- Wrote 12 runbooks still in use" });
    expect(story.ok && story.markdown).toContain("- Wrote 12 runbooks still in use");
    expect(story.ok && story.oldText).toContain("- Wrote runbooks");
    expect(story.ok && story.markdown).toContain("## S1 · Import that kept failing");
    const fix = applyTuneSuggestion(VOICE, { operation: "replace", file: "profile/interview_voice.md", section: "Delivery fixes", target: "Slow down", text: "Answer first, then context" });
    expect(fix.ok && fix.markdown).toContain("- Answer first, then context");
    expect(fix.ok && fix.markdown).not.toContain("Slow down");
  });

  it("archives an item and refuses a target that is gone or ambiguous", () => {
    const archived = applyTuneSuggestion(VOICE, { operation: "archive", file: "profile/interview_voice.md", section: "Phrases I use", target: "synergy" });
    expect(archived.ok && archived.markdown).not.toContain("synergy");
    expect(archived.ok && archived.oldText).toBe("- synergy");
    expect(applyTuneSuggestion(VOICE, { operation: "archive", file: "profile/interview_voice.md", section: "Phrases I use", target: "never said" }).ok).toBe(false);
  });
});

describe("a Tune run (#117)", () => {
  it("briefs Agy on only what changed, banks its suggestions, applies the picked ones, and undoes", async () => {
    const { root, write, read } = await workspace();
    expect(Object.keys(await changedSources(root, "career"))).toEqual(["context/broad/northstar-notes.md"]);
    const { prompt, sources } = await startTune(root, "career");
    expect(prompt).toBe("Tune my career records: read .sensei/tune/career-brief.md first, then follow it.");
    expect(sources).toEqual(["context/broad/northstar-notes.md"]);
    expect(await read(".sensei/tune/career-brief.md")).toContain("`context/structured/work-evidence.md`");
    expect((await tuneStatus(root, ["career"]))[0]).toMatchObject({ waitingForAgy: true, suggestionsReady: false });

    const rows = Array.from({ length: 7 }, (_, n) => suggestion({ text: `| context:work:item-${n} | 2025 | Item ${n} | Claim ${n} | solo | notes | high | eligible |`, urgency: (n % 5) + 1 }));
    await write(tuneSuggestionsFile("career"), JSON.stringify({ schemaVersion: 1, area: "career", suggestions: [
      ...rows,
      suggestion({ operation: "enrich", target: "context:work:runbooks", text: "| context:work:runbooks | 2024 | Runbooks | Wrote 12 runbooks | solo | notes | high | eligible |", urgency: 5, impact: 5 }),
      suggestion({ file: "profile/story_bank.md", section: "S9", text: "## S9 · x" }),
      suggestion({ source: "context/broad/other.md", text: "| context:work:other | 2025 | x | y | z | n | high | eligible |" }),
    ] }));
    const collected = await collectTune(root, "career");
    expect(collected.added).toBe(8);
    expect(collected.problems).toHaveLength(2);
    expect(collected.shown).toHaveLength(5);
    expect(collected.banked).toBe(3);
    expect(collected.shown[0]!.operation).toBe("enrich");
    expect(Object.keys(await changedSources(root, "career"))).toEqual([]);
    await expect(startTune(root, "career")).rejects.toThrow(/Nothing new/);

    const [enrich, keep, decline] = collected.shown;
    const outcome = await applyTune(root, "career", [enrich!.id, keep!.id], [decline!.id]);
    expect(outcome.applied).toEqual([enrich!.id, keep!.id]);
    const records = await read("context/structured/work-evidence.md");
    expect(records).toContain("Wrote 12 runbooks");
    expect(records).toContain(keep!.text!);
    const history = JSON.parse(await read(TUNE_HISTORY_FILE)) as { entries: Array<{ oldText: string }> };
    expect(history.entries[0]!.oldText).toContain("| Wrote runbooks |");
    const after = await tuneView(root, "career");
    expect(after.shown.map((item) => item.id)).not.toContain(decline!.id);
    expect(after.shown.length + after.banked).toBe(5);

    await undoTune(root);
    expect(await read("context/structured/work-evidence.md")).toBe(RECORDS);
    expect((await tuneView(root, "career")).shown.map((item) => item.id)).toContain(enrich!.id);
  });

  it("drops banked suggestions once their source changes, and rejects a delete", async () => {
    const { root, write } = await workspace();
    await startTune(root, "career");
    await write(tuneSuggestionsFile("career"), JSON.stringify({ schemaVersion: 1, area: "career", suggestions: [suggestion({ text: "| context:work:a | 2025 | a | b | c | d | high | eligible |" })] }));
    expect((await collectTune(root, "career")).shown).toHaveLength(1);
    await write("context/broad/northstar-notes.md", "Alex wrote 14 runbooks.\n");
    expect((await tuneView(root, "career")).shown).toHaveLength(0);

    await startTune(root, "career");
    await write(tuneSuggestionsFile("career"), JSON.stringify({ schemaVersion: 1, area: "career", suggestions: [suggestion({ operation: "delete" as never, target: "context:work:runbooks" })] }));
    await expect(collectTune(root, "career")).rejects.toThrow(/don't match the format/);
  });

  it("won't start while Agy is running a job", async () => {
    const { root, write } = await workspace();
    await write(".sensei/job_queue.json", JSON.stringify({ autoRun: true, items: [{ id: "abc123", kind: "link", url: "https://example.com/job", addedAt: "2026-11-24T00:00:00.000Z", status: "running" }] }));
    await expect(startTune(root, "career")).rejects.toThrow(/running a job/);
  });
});
