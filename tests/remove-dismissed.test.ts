// #210: dismissed matches can be removed for good; they never come back in a search.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSearchState, removeDismissed, saveSearchState } from "../electron/job-search";
import { canonicalUrl, jobKey, type InboxItem } from "../src/shared/job-search";

const found = (id: string, status: InboxItem["status"]) => ({
  id, url: `https://jobs.example.com/northstar/${id}`, title: `Support Engineer ${id}`, company: "Northstar Labs", status,
  location: null, workSetup: null, pay: null, level: null, postedAt: null, board: "lever", runId: "r1", foundAt: "2026-11-20T00:00:00.000Z",
  fit: { score: 3, why: "", covered: 0, total: 0, gaps: [], blockers: [], flags: [] }, jobId: null, queuedAt: null, autoQueued: false, watched: false, agyFit: null,
}) as InboxItem;

describe("remove dismissed matches (#210)", () => {
  it("removes only dismissed matches and keeps their keys in seen", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-dismissed-"));
    await saveSearchState(root, { schemaVersion: 1, runs: [], seen: [], pendingDrafts: [], items: [found("find-aaaa", "dismissed"), found("find-baaa", "new"), found("find-caaa", "dismissed")] });
    const after = await removeDismissed(root, ["find-aaaa", "find-baaa"]);
    expect(after.items.map((item) => item.id)).toEqual(["find-baaa", "find-caaa"]);
    const saved = await readSearchState(root);
    expect(saved.seen).toContain(canonicalUrl("https://jobs.example.com/northstar/find-aaaa"));
    expect(saved.seen).toContain(jobKey("Northstar Labs", "Support Engineer find-aaaa"));
  });
});
