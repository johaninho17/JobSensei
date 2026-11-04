import { describe, expect, it } from "vitest";
import { pruneUnsupportedSkills } from "../electron/application-artifacts";
import { expandBundleBaselines } from "../electron/application-finalize";
import { restatedRequirements } from "../electron/application-validation";
import type { ApplicationBundle, ApplicationContext, EvidenceSnapshot } from "../src/shared/schemas";

const row = (evidenceId: string, claim: string, employer = "Northstar Labs") => ({
  evidenceId, year: "2025", startYear: 2025, endYear: 2026, isOngoing: true, recencyBand: "current", project: employer, employer, claim,
  scope: "Hands-on scope.", sourcePath: "context/structured/work.md", sourceFamily: null, sourceLocator: "W", confidence: "high",
  classification: "verified", eligibility: "eligible",
});
const canonicalResume = {
  baselineId: "b1",
  originalSkillsLines: ["**Engineering:** TypeScript, Docker"],
  employers: [
    { name: "Northstar Labs", originalBulletCount: 1, originalBullets: ["Supported API integrations for customer teams."] },
    { name: "Earlier Co", originalBulletCount: 1, originalBullets: ["Built reporting dashboards for operations staff."] },
  ],
};
const snapshot = {
  jobId: "x", canonicalResume,
  evidenceRows: [row("context:work:api", "Configured REST API integrations in Python and PostgreSQL."), row("context:earlier:etl", "Wrote ETL jobs in Python.", "Earlier Co")],
} as unknown as EvidenceSnapshot;

describe("draft guards", () => {
  it("drops skills no evidence supports and keeps the rest in order", () => {
    expect(pruneUnsupportedSkills("**Data & BI:** SQL Queries, PostgreSQL, Jira, User Stories & Acceptance Criteria, Docker.", [], snapshot))
      .toEqual({ text: "**Data & BI:** PostgreSQL, Docker.", removed: ["SQL Queries", "Jira", "User Stories & Acceptance Criteria"] });
    expect(pruneUnsupportedSkills("**Engineering:** TypeScript, Docker", [], snapshot).removed).toEqual([]);
    expect(pruneUnsupportedSkills("**Tools:** Jira, Confluence", [], snapshot).text).toBe("");
  });

  it("keeps an earlier role as in the base resume unless its changed bullets cite that employer", () => {
    const context = { schemaVersion: 2, resumeTemplate: { employers: [] }, evidenceRows: snapshot.evidenceRows } as unknown as ApplicationContext;
    const bundle = (earlier: string, ids: string[]) => ({
      warnings: [],
      resume: { skillsLines: [], employers: [{ name: "Earlier Co", bullets: [{ text: earlier, evidenceIds: ids }] }] },
    }) as unknown as ApplicationBundle;
    const unbacked = expandBundleBaselines(bundle("Led enterprise data platform strategy.", ["context:work:api"]), canonicalResume as never, context);
    expect(unbacked.resume.employers[1]!.bullets.map((b) => b.text)).toEqual(["Built reporting dashboards for operations staff."]);
    expect(unbacked.warnings[0]).toMatch(/Kept Earlier Co as in the base resume/);
    const backed = expandBundleBaselines(bundle("Wrote Python ETL jobs feeding operations dashboards.", ["context:earlier:etl"]), canonicalResume as never, context);
    expect(backed.resume.employers[1]!.bullets.map((b) => b.text)).toEqual(["Wrote Python ETL jobs feeding operations dashboards."]);
  });

  it("flags a letter sentence that restates a required item", () => {
    const requirement = "Demonstrated experience using enterprise-authorized AI capabilities within the work environment to support solutions analysis workflows with strong validation habits and awareness of data sensitivity.";
    const letter = "When a partner needed its data kept in its own environment, I mapped that against our deployment. In every engagement, I use AI capabilities responsibly while maintaining strict validation habits over data sensitivity.";
    expect(restatedRequirements(letter, [requirement]).map((item) => item.sentence)).toEqual(["In every engagement, I use AI capabilities responsibly while maintaining strict validation habits over data sensitivity."]);
  });
});
