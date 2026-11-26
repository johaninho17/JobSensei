import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { provenLinesFor } from "../electron/proven-lines";
import { companyResearchFor } from "../electron/interview-context";
import { likeInterviewed, searchLearning } from "../electron/job-search";
import { rankInbox } from "../src/shared/job-search";
import type { JobFolderSummary } from "../src/shared/schemas";

const NOW = new Date("2026-11-10T12:00:00Z");
const job = (id: string, patch: Partial<JobFolderSummary> = {}): JobFolderSummary => ({
  id, relativePath: `jobs/${id}`, name: id, title: "Solutions Engineer", company: "Northstar Labs", createdAt: "2026-10-01T10:00:00Z", modifiedAt: "2026-10-01T10:00:00Z",
  artifactCount: 3, applicationStage: null, rating: 3.6, ratingDecision: null, ratingConfidence: null, ratingHighlights: [], ratingGaps: [], mustHaves: [], requirementGaps: [],
  stretch: null, location: null, interviewRoundLabel: null, interviewRoundCount: 0, role: null, hasApplicationMaterials: true, tracker: null, health: null, gapTerms: [], ...patch,
}) as JobFolderSummary;
const tracker = (patch: Record<string, unknown>) => ({ schemaVersion: 1, status: "applied", appliedAt: "2026-10-01", nextFollowUpAt: null, notes: "", history: [], interviews: [], outcome: null, updatedAt: null, ...patch }) as never;

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-learning-"));
  await mkdir(join(root, ".sensei"), { recursive: true });
  return root;
}

describe("learning from interviews", () => {
  it("offers lines from resumes that got interviews only when all their evidence is routed to the new job", async () => {
    const root = await workspace();
    await mkdir(join(root, "jobs/won/.sensei"), { recursive: true });
    await writeFile(join(root, "jobs/won/.sensei/tracker.json"), JSON.stringify({ interviews: [{ round: "recruiter" }] }));
    await writeFile(join(root, "jobs/won/.sensei/application_evidence.json"), JSON.stringify({ resume: { claimMappings: [
      { publicText: "Led onboarding for enterprise customers.", claimType: "candidate", evidenceIds: ["context:a:1"] },
      { publicText: "Built dashboards in Looker.", claimType: "framed", evidenceIds: ["context:a:2", "context:b:9"] },
      { publicText: "Unchanged base bullet.", claimType: "baseline", evidenceIds: [] },
    ] } }));
    const lines = await provenLinesFor(root, new Set(["context:a:1", "context:a:2"]), () => "Northstar Labs");
    expect(lines).toEqual([{ text: "Led onboarding for enterprise customers.", evidenceIds: ["context:a:1"], employer: "Northstar Labs", from: "won" }]);
  });

  it("reuses recent company research from another job at the same company", async () => {
    const root = await workspace();
    for (const id of ["northstar-se", "northstar-pm"]) {
      await mkdir(join(root, `jobs/${id}/.sensei`), { recursive: true });
      await writeFile(join(root, `jobs/${id}/.sensei/job.json`), JSON.stringify({ company: "Northstar Labs, Inc." }));
    }
    await mkdir(join(root, "jobs/northstar-se/interviews"), { recursive: true });
    await writeFile(join(root, "jobs/northstar-se/interviews/company_research.md"), "# Research");
    expect(await companyResearchFor(root, "northstar-pm", "Northstar Labs", NOW)).toMatchObject({ path: null, reuseFrom: "jobs/northstar-se/interviews/company_research.md" });
    expect(await companyResearchFor(root, "northstar-pm", "Northstar Labs", new Date(Date.now() + 90 * 86_400_000))).toMatchObject({ reuseFrom: null });
    expect(await companyResearchFor(root, "northstar-se", "Northstar Labs", NOW)).toMatchObject({ path: "jobs/northstar-se/interviews/company_research.md" });
  });

  it("ranks matches like jobs that got interviews a little higher", () => {
    const learned = searchLearning([job("won", { title: "Technical Implementation Specialist", company: "Northstar Labs", tracker: tracker({ interviews: [{ round: "recruiter", date: "2026-11-01", note: "", source: "user" }] }) })]);
    expect(likeInterviewed("Implementation Specialist, Technical", learned)).toBe("Like your Northstar Labs interview");
    expect(likeInterviewed("Account Executive", learned)).toBeNull();
    const item = (id: string, score: number, like: string | null) => ({ id, fit: { score, why: "", covered: 0, total: 0, gaps: [], blockers: [], flags: [] }, agyFit: null, likeInterviewed: like, foundAt: NOW.toISOString(), postedAt: null }) as never;
    expect(rankInbox([item("plain", 3.8, null), item("like", 3.6, "Like your interview")]).map((entry: { id: string }) => entry.id)).toEqual(["like", "plain"]);
  });
});
