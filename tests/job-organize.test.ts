import { describe, expect, it } from "vitest";
import { NO_FACETS, companySummary, facetOptions, findDuplicateJob, groupJobs, matchesFacets, normalizeTags, roleFamily } from "../src/shared/job-organize";
import { jobFolderSummarySchema, jobTrackerSchema, type JobFolderSummary } from "../src/shared/schemas";

function job(id: string, extra: Partial<JobFolderSummary> & { tags?: string[]; status?: string; workMode?: "remote" | "hybrid" | "onsite"; source?: string } = {}): JobFolderSummary {
  const { tags, status, workMode, source, ...rest } = extra;
  return jobFolderSummarySchema.parse({
    id, relativePath: `jobs/${id}`, name: id, createdAt: "2026-11-01T10:00:00.000Z", modifiedAt: "2026-11-01T10:00:00.000Z", artifactCount: 1,
    tracker: jobTrackerSchema.parse({ status: status ?? "applied", tags: tags ?? [] }),
    role: workMode || source ? { workMode: workMode ?? null, source: source ?? null } : null,
    ...rest,
  });
}

const jobs = [
  job("northstar-support-engineer", { company: "Northstar Labs", title: "Senior Support Engineer", rating: 4.2, workMode: "remote", tags: ["referral"], source: "https://boards.greenhouse.io/northstar/jobs/123" }),
  job("northstar-solutions-engineer", { company: "Northstar Labs, Inc.", title: "Solutions Engineer II", rating: 3.4, workMode: "hybrid", status: "rejected" }),
  job("harbor-solutions-engineer", { company: "Harbor", title: "Solutions Engineer", rating: 2.5, workMode: "onsite", tags: ["Referral", "dream job"] }),
  job("quill-analyst", { company: "Quill", title: "Data Analyst", status: "saved" }),
];

describe("organizing jobs", () => {
  it("filters by company, work setup, fit, and tags together", () => {
    expect(jobs.filter((entry) => matchesFacets(entry, NO_FACETS))).toHaveLength(4);
    expect(jobs.filter((entry) => matchesFacets(entry, { ...NO_FACETS, company: "Northstar Labs" })).map((entry) => entry.id)).toEqual(["northstar-support-engineer", "northstar-solutions-engineer"]);
    expect(jobs.filter((entry) => matchesFacets(entry, { ...NO_FACETS, work: ["remote", "onsite"] })).map((entry) => entry.id)).toEqual(["northstar-support-engineer", "harbor-solutions-engineer"]);
    expect(jobs.filter((entry) => matchesFacets(entry, { ...NO_FACETS, fit: ["unrated"] })).map((entry) => entry.id)).toEqual(["quill-analyst"]);
    expect(jobs.filter((entry) => matchesFacets(entry, { ...NO_FACETS, tags: ["referral"] })).map((entry) => entry.id)).toEqual(["northstar-support-engineer", "harbor-solutions-engineer"]);
    expect(jobs.filter((entry) => matchesFacets(entry, { ...NO_FACETS, tags: ["referral"], fit: ["high"] })).map((entry) => entry.id)).toEqual(["northstar-support-engineer"]);
  });

  it("counts each filter choice and treats one company's spellings as one", () => {
    const options = facetOptions(jobs);
    expect(options.companies.find((company) => company.name.startsWith("Northstar"))?.count).toBe(2);
    expect(options.tags).toEqual([{ name: "dream job", count: 1 }, { name: "referral", count: 2 }]);
    expect(options.work).toEqual({ remote: 1, hybrid: 1, onsite: 1, unknown: 1 });
    expect(options.fit).toEqual({ high: 1, mid: 1, low: 1, unrated: 1 });
  });

  it("groups by company and by kind of role, ignoring level words", () => {
    expect(groupJobs(jobs, "none")).toHaveLength(1);
    const byCompany = groupJobs(jobs, "company");
    expect(byCompany[0]!.jobs).toHaveLength(2);
    expect(byCompany.map((group) => group.jobs.length)).toEqual([2, 1, 1]);
    expect(roleFamily("Senior Solutions Engineer II")).toBe("solutions engineer");
    expect(roleFamily("Solutions Engineer, Enterprise")).toBe("solutions engineer");
    const byRole = groupJobs(jobs, "role");
    expect(byRole[0]!.label).toBe("Solutions Engineer");
    expect(byRole[0]!.jobs.map((entry) => entry.id)).toEqual(["northstar-solutions-engineer", "harbor-solutions-engineer"]);
    expect(groupJobs(jobs, "status").map((group) => group.key)).toEqual(["saved", "applied", "rejected"]);
  });

  it("summarizes a company", () => {
    const summary = companySummary(jobs, "northstar labs");
    expect(summary.jobs).toBe(2);
    expect(summary.averageFit).toBe(3.8);
    expect(summary.statuses.map((entry) => `${entry.count} ${entry.status}`).sort()).toEqual(["1 applied", "1 rejected"]);
  });

  it("cleans tags", () => {
    expect(normalizeTags(["#Referral", "referral ", "", "dream   job"])).toEqual(["Referral", "dream job"]);
    expect(normalizeTags(Array.from({ length: 20 }, (_value, index) => `t${index}`))).toHaveLength(12);
  });

  it("spots a job that is already there, by link or by company and title", () => {
    expect(findDuplicateJob(jobs, { url: "https://boards.greenhouse.io/northstar/jobs/123/" })?.id).toBe("northstar-support-engineer");
    expect(findDuplicateJob(jobs, { url: "https://example.com/other", company: "Harbor Inc", title: "Solutions Engineer" })?.id).toBe("harbor-solutions-engineer");
    expect(findDuplicateJob(jobs, { company: "Harbor", title: "Support Engineer" })).toBeNull();
    expect(findDuplicateJob(jobs, { title: "Solutions Engineer" })).toBeNull();
  });
});

describe("quick-filter counts (#15)", () => {
  it("count only the jobs the open tab shows, so each number equals the rows it filters to", async () => {
    const { countWithin } = await import("../src/shared/job-organize");
    const jobs = [{ id: "a", status: "applied", fav: true }, { id: "b", status: "applied", fav: false }, { id: "c", status: "rejected", fav: true }, { id: "d", status: "rejected", fav: true }];
    const appliedTab = (job: { status: string }) => job.status === "applied";
    const counts = countWithin(jobs, appliedTab, ["all", "favorites"], (job, filter) => filter === "all" || job.fav);
    expect(counts).toEqual({ all: 2, favorites: 1 });
  });
});
