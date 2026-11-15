// #88: Jobs filter and sort by the settings band the drafts were made under; Learnings compares interview rates.
import { describe, expect, it } from "vitest";
import { NO_FACETS, facetOptions, matchesFacets, settingsBandOf, settingsSortKey } from "../src/shared/job-organize";
import { computeLearnings } from "../src/shared/learnings";
import { jobFolderSummarySchema, jobTrackerSchema, type JobFolderSummary } from "../src/shared/schemas";

const score = (value: number) => ({ score: value, band: value >= 75 ? "bold" : value >= 50 ? "balanced" : value >= 25 ? "careful" : "strict", parts: { framing: 5, "fit-credit": 5, "fit-gate": 5, "lines-reworked": 5 }, behavior: {} });
function job(id: string, extra: { settings?: number | null; drafts?: boolean; status?: string; interviewed?: boolean } = {}): JobFolderSummary {
  return jobFolderSummarySchema.parse({
    id, relativePath: `jobs/${id}`, name: id, company: id, createdAt: "2026-11-01T10:00:00.000Z", modifiedAt: "2026-11-01T10:00:00.000Z", artifactCount: 1,
    hasApplicationMaterials: extra.drafts ?? extra.settings !== undefined,
    settingsScore: typeof extra.settings === "number" ? score(extra.settings) : null,
    tracker: jobTrackerSchema.parse({ status: extra.status ?? "applied", interviews: extra.interviewed ? [{ round: "recruiter", date: "2026-11-05", note: "", source: "user" }] : [] }),
  });
}

const jobs = [job("strict-one", { settings: 20 }), job("bold-one", { settings: 80, interviewed: true }), job("bold-two", { settings: 90 }), job("old-draft", { drafts: true }), job("no-drafts", { status: "saved" })];

describe("jobs by Agy settings band (#88)", () => {
  it("each job's band: its stamped score, today's default for older drafts, none without drafts", () => {
    expect(jobs.map(settingsBandOf)).toEqual(["strict", "bold", "bold", "balanced", "none"]);
  });
  it("filters and counts by band", () => {
    expect(jobs.filter((entry) => matchesFacets(entry, { ...NO_FACETS, settings: ["bold"] })).map((entry) => entry.id)).toEqual(["bold-one", "bold-two"]);
    expect(facetOptions(jobs).settings).toEqual({ strict: 1, careful: 0, balanced: 1, bold: 2, none: 1 });
    expect(matchesFacets(jobs[0]!, { ...NO_FACETS })).toBe(true);
  });
  it("sorts boldest first, jobs without drafts last", () => {
    expect([...jobs].sort((a, b) => settingsSortKey(b) - settingsSortKey(a)).map((entry) => entry.id)).toEqual(["bold-two", "bold-one", "old-draft", "strict-one", "no-drafts"]);
  });
  it("Learnings shows the interview rate per band for applied jobs", () => {
    expect(computeLearnings(jobs).bySettings).toEqual([
      { band: "strict", label: "Strict", applied: 1, interviewed: 0 },
      { band: "balanced", label: "Balanced", applied: 1, interviewed: 0 },
      { band: "bold", label: "Bold", applied: 2, interviewed: 1 },
    ]);
  });
});
