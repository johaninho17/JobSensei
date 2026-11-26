// #107 (ledger U76): Tune suggestion schemas, golden fixtures, ranking, and the write lock. Fictional candidate only.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWriteLocked, jobLock, withWriteLock } from "../electron/write-lock";
import {
  TUNE_AREAS, TUNE_SHOWN, freshBanked, rankTuneSuggestions, tuneBankSchema, tuneSuggestionId, tuneSuggestionSchema, tuneSuggestionsFileSchema,
  type TuneSuggestion,
} from "../src/shared/tune-schemas";

const fixture = async (area: string) => JSON.parse(await readFile(join("tests", "fixtures", "tune", `${area}.json`), "utf8")) as unknown;

function suggestion(n: number, urgency: number, impact: number, source = "debrief/a.md"): TuneSuggestion {
  return tuneSuggestionSchema.parse({
    id: `t-${n.toString(16).padStart(12, "0")}`, area: "interviews", operation: "add", file: "profile/story_bank.md", section: "Stories",
    text: `story ${n}`, reason: "new", source, sourceHash: "h1", urgency, impact, createdAt: "2026-11-24T00:00:00.000Z",
  });
}

describe("Tune suggestion files (#107)", () => {
  it("every golden fixture parses, one per area", async () => {
    for (const area of TUNE_AREAS) {
      const parsed = tuneSuggestionsFileSchema.parse(await fixture(area));
      expect(parsed.area).toBe(area);
      expect(parsed.suggestions.length).toBeGreaterThan(0);
    }
  });

  it("has no delete: an unknown operation, a stray field, or a missing schemaVersion is rejected", async () => {
    const good = await fixture("interviews") as { suggestions: Array<Record<string, unknown>> };
    const withOperation = (operation: string) => ({ ...good, suggestions: [{ ...good.suggestions[0], operation }] });
    expect(tuneSuggestionsFileSchema.safeParse(withOperation("delete")).success).toBe(false);
    expect(tuneSuggestionsFileSchema.safeParse({ ...good, deletions: ["S2"] }).success).toBe(false);
    expect(tuneSuggestionsFileSchema.safeParse({ ...good, suggestions: [{ ...good.suggestions[0], remove: true }] }).success).toBe(false);
    expect(tuneSuggestionsFileSchema.safeParse({ ...good, schemaVersion: undefined }).success).toBe(false);
    expect(tuneSuggestionsFileSchema.safeParse({ ...good, schemaVersion: 2 }).success).toBe(false);
  });

  it("needs a target to change an item, new text to replace it, and no text to archive it", async () => {
    const good = await fixture("interviews") as { suggestions: Array<Record<string, unknown>> };
    const one = (patch: Record<string, unknown>) => tuneSuggestionsFileSchema.safeParse({ ...good, suggestions: [{ ...good.suggestions[2], ...patch }] }).success;
    expect(one({})).toBe(true);
    expect(one({ target: undefined })).toBe(false);
    expect(one({ text: undefined })).toBe(false);
    expect(one({ operation: "archive" })).toBe(false);
    expect(one({ operation: "archive", text: undefined })).toBe(true);
    expect(one({ file: "../outside.md" })).toBe(false);
    expect(one({ urgency: 9 })).toBe(false);
  });

  it("gives the same suggestion the same ID, whatever the spacing or case", async () => {
    const file = tuneSuggestionsFileSchema.parse(await fixture("interviews"));
    const first = file.suggestions[2]!;
    const again = { ...first, text: `  ${first.text!.toUpperCase()}  `, reason: "a different reason" };
    expect(tuneSuggestionId("interviews", first)).toMatch(/^t-[0-9a-f]{12}$/);
    expect(tuneSuggestionId("interviews", again)).toBe(tuneSuggestionId("interviews", first));
    expect(new Set(file.suggestions.map((item) => tuneSuggestionId("interviews", item))).size).toBe(file.suggestions.length);
  });
});

describe("ranking and the bank (#107)", () => {
  it("shows at most five, highest urgency × impact first, and never a declined one", () => {
    const items = [suggestion(1, 1, 1), suggestion(2, 5, 5), suggestion(3, 3, 3), suggestion(4, 4, 2), suggestion(5, 2, 4), suggestion(6, 5, 4), suggestion(7, 1, 2)];
    const { shown, banked } = rankTuneSuggestions(items, [items[1]!.id]);
    expect(shown).toHaveLength(TUNE_SHOWN);
    expect(shown.map((item) => item.text)).toEqual(["story 6", "story 3", "story 4", "story 5", "story 7"]);
    expect(banked.map((item) => item.text)).toEqual(["story 1"]);
  });

  it("drops banked suggestions whose source changed or is gone", () => {
    const bank = tuneBankSchema.parse({ schemaVersion: 1, items: [suggestion(1, 3, 3, "debrief/a.md"), suggestion(2, 3, 3, "debrief/b.md"), suggestion(3, 3, 3, "debrief/c.md")] });
    expect(freshBanked(bank.items, { "debrief/a.md": "h1", "debrief/b.md": "h2", "debrief/c.md": null }).map((item) => item.source)).toEqual(["debrief/a.md"]);
  });
});

describe("the write lock (#107)", () => {
  it("runs tasks on the same key one at a time, in order, even when one fails", async () => {
    const log: string[] = [];
    const slow = (name: string, ms: number, fail = false) => withWriteLock(jobLock("northstar"), async () => {
      log.push(`${name} start`);
      await new Promise((done) => setTimeout(done, ms));
      log.push(`${name} end`);
      if (fail) throw new Error("boom");
      return name;
    });
    const results = await Promise.allSettled([slow("a", 20, true), slow("b", 5), slow("c", 1)]);
    expect(log).toEqual(["a start", "a end", "b start", "b end", "c start", "c end"]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
    expect(isWriteLocked(jobLock("northstar"))).toBe(false);
  });

  it("lets different keys run at the same time", async () => {
    const log: string[] = [];
    const task = (key: string, name: string, ms: number) => withWriteLock(key, async () => { log.push(`${name} start`); await new Promise((done) => setTimeout(done, ms)); log.push(`${name} end`); });
    await Promise.all([task(jobLock("one"), "one", 15), task("career", "career", 1)]);
    expect(log).toEqual(["one start", "career start", "career end", "one end"]);
  });
});
