// Issue #234: Went to interview keeps jobs that had interviews, even after they are rejected or archived.
import { describe, expect, it } from "vitest";
import { inJobsTab } from "../src/renderer/JobsHome";
import type { JobFolderSummary } from "../src/shared/schemas";

const job = (tracker: Record<string, unknown>, extra: Partial<JobFolderSummary> = {}) => ({ id: "northwind-ops", name: "northwind-ops", interviewRoundLabel: null, interviewRoundCount: 0, applicationStage: null, hasApplicationMaterials: true, tracker: { schemaVersion: 1, history: [], tags: [], interviews: [], ...tracker }, ...extra }) as unknown as JobFolderSummary;

describe("Went to interview (#234)", () => {
  it("includes a rejected job that had interviews, and it still shows under Archived", () => {
    const rejected = job({ status: "rejected", history: [{ status: "applied", at: "2026-10-01" }, { status: "interviewing", at: "2026-10-10" }, { status: "rejected", at: "2026-10-20" }] });
    expect(inJobsTab(rejected, "reached")).toBe(true);
    expect(inJobsTab(rejected, "archived")).toBe(true);
    expect(inJobsTab(rejected, "active")).toBe(false);
  });
  it("includes an archived job with recorded rounds, and leaves out archived jobs that never interviewed", () => {
    expect(inJobsTab(job({ status: "applied", archivedAt: "2026-11-01" }, { interviewRoundCount: 2 }), "reached")).toBe(true);
    expect(inJobsTab(job({ status: "rejected", history: [{ status: "applied", at: "2026-10-01" }, { status: "rejected", at: "2026-10-05" }] }), "reached")).toBe(false);
  });
});
