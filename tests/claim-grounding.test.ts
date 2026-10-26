import { describe, expect, it } from "vitest";
import { ClaimValidationError, validateCoverLetterAuditJson, validateResumeAuditJson, type ClaimFailure } from "../electron/application-artifacts";
import type { EvidenceSnapshot } from "../src/shared/schemas";

// Grounding checks named terms, not word overlap: wording may be framed (ledger T4),
// but a skill, tool, or name must come from a cited row or the base resume.

function row(evidenceId: string, claim: string, extra: Record<string, unknown> = {}) {
  return {
    evidenceId, year: "2025", startYear: 2025, endYear: 2026, isOngoing: true, recencyBand: "current",
    project: "Northstar Labs", employer: "Northstar Labs", claim, scope: "Hands-on scope.",
    sourcePath: "context/structured/work.md", sourceFamily: null, sourceLocator: "Work", confidence: "high",
    classification: "verified", eligibility: "eligible", ...extra,
  };
}

function snapshot(): EvidenceSnapshot {
  return {
    schemaVersion: 1, snapshotId: "snapshot-1", jobId: "sample-role", generatedAt: "2026-07-29T00:00:00.000Z",
    manifestGeneratedAt: "2026-07-29T00:00:00.000Z", manifestHash: "manifest-1", baseResumePath: "resumes/base.md",
    secondaryResumePaths: [], selectedStructuredPaths: ["context/structured/work.md"], selectedBroadPaths: [], selectedJobFiles: [],
    policyPaths: [], sourceFiles: [], denylistRules: [],
    canonicalResume: {
      baselineId: "baseline-1",
      originalSkillsLines: ["**Engineering:** TypeScript, PostgreSQL, Docker"],
      employers: [{ name: "Northstar Labs", originalBulletCount: 1, originalBullets: ["Supported API integrations for customer teams."] }],
    },
    evidenceRows: [
      row("job:sample-role:original-jd", "# Support Engineer - Acme\n\nYou will use Grafana and Kubernetes daily.", { employer: null, sourcePath: "jobs/sample-role/original_jd.md" }),
      row("context:work:api", "Configured and tested REST API integrations in Python for customer workflows."),
      row("context:work:agents", "Built AI agent steps that connect Slack and Google Drive to internal reports."),
    ],
  } as unknown as EvidenceSnapshot;
}

const header = { schemaVersion: 1, validationStatus: "passed" as const, evidenceSnapshotId: "snapshot-1", manifestHash: "manifest-1", baseResumePath: "resumes/base.md" };
const mapping = (publicText: string, evidenceIds: string[], claimType = "candidate") => ({
  publicText, claimType, evidenceIds, sourcePaths: evidenceIds.length ? ["context/structured/work.md"] : [], timeline: "current", ownership: "supported",
});
function resume(skills: string, bullets: Array<[string, string[]]>, skillIds: string[]) {
  const markdown = `## Skills\n${skills}\n\n## Professional Experience\n**Northstar Labs** — Solutions Engineer\n${bullets.map(([text]) => `* ${text}`).join("\n")}`;
  const audit = {
    ...header, artifactType: "resume" as const, publicArtifact: "Alex_Morgan_Sample_Resume.md",
    claimMappings: [mapping(skills, skillIds), ...bullets.map(([text, ids]) => mapping(text, ids))],
    sideBySideChanges: [], suggestedAdditionalBullets: [], metricOpportunities: [],
  };
  return { audit, markdown };
}
function check(audit: unknown, markdown: string, kind: "resume" | "cover" = "resume"): ClaimFailure[] {
  const claimFailures: ClaimFailure[] = [];
  const options = { publicMarkdown: markdown, publicArtifactName: kind === "resume" ? "Alex_Morgan_Sample_Resume.md" : "cover_letter.md", snapshot: snapshot(), leanEvidenceMap: true, claimFailures };
  try {
    if (kind === "resume") validateResumeAuditJson(audit, options);
    else validateCoverLetterAuditJson(audit, options);
  } catch { /* document-level rules are not under test here */ }
  return claimFailures;
}

describe("skills lines are checked term by term", () => {
  it("accepts terms from any eligible routed row, even one the line did not cite", () => {
    const { audit, markdown } = resume("**Engineering:** Slack, Google Drive, Python", [], ["context:work:api"]);
    expect(check(audit, markdown)).toEqual([]);
  });

  it("accepts terms found in the cited rows or the base resume", () => {
    const { audit, markdown } = resume("**Engineering:** Python, REST APIs, PostgreSQL, Docker, Slack", [], ["context:work:api", "context:work:agents"]);
    expect(check(audit, markdown)).toEqual([]);
  });

  it("names each term that no eligible row or base-resume line contains", () => {
    const { audit, markdown } = resume("**Engineering:** Python, Kubernetes, PostgreSQL, Terraform", [], ["context:work:api"]);
    const failures = check(audit, markdown);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toMatch(/Kubernetes, Terraform/);
    expect(failures[0].message).not.toMatch(/Python|PostgreSQL/);
    expect(failures[0].explanation.sources.map((source) => source.evidenceId)).toEqual(["context:work:api"]);
  });

  it("accepts a skills line backed only by the base resume, with no evidence ID", () => {
    const { audit, markdown } = resume("**Engineering:** TypeScript, Docker", [], []);
    expect(check(audit, markdown)).toEqual([]);
  });
});

describe("framed wording may change, named facts may not", () => {
  it("accepts a reworded bullet whose named terms are all in its row", () => {
    const { audit, markdown } = resume("**Engineering:** Python", [["Set up and validated Python REST API integrations so customer workflows ran cleanly.", ["context:work:api"]]], ["context:work:api"]);
    expect(check(audit, markdown)).toEqual([]);
  });

  it("flags a bullet that adds a tool its row never mentions", () => {
    const { audit, markdown } = resume("**Engineering:** Python", [["Configured REST API integrations in Python and Kubernetes for customer workflows.", ["context:work:api"]]], ["context:work:api"]);
    const failures = check(audit, markdown);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toMatch(/Kubernetes/);
  });

  it("reports every failing line, not just the first", () => {
    const { audit, markdown } = resume("**Engineering:** Terraform", [
      ["Configured REST API integrations with Kubernetes.", ["context:work:api"]],
      ["Built AI agent steps for Grafana reports.", ["context:work:agents"]],
    ], ["context:work:api"]);
    expect(check(audit, markdown).map((failure) => failure.explanation.sentence)).toHaveLength(3);
  });

  it("accepts a framed cover-letter sentence that rewords its row", () => {
    const text = "At Northstar Labs I connected Slack and Google Drive to internal reports through AI agents, which taught me how teams really use their tools.";
    const audit = {
      ...header, artifactType: "cover-letter" as const, publicArtifact: "cover_letter.md",
      claimMappings: [mapping(text, ["context:work:agents"], "framed")],
      careerArc: [{ stage: "AI agent steps", timeline: "current", evidenceIds: ["context:work:agents"] }],
    };
    const failures = check(audit, `Dear team,\n\n${text}\n\nSincerely,\nAlex`, "cover");
    expect(failures.filter((failure) => /overlap|mention/.test(failure.message))).toEqual([]);
  });

  it("still throws on the first failure when no collector is passed", () => {
    const { audit, markdown } = resume("**Engineering:** Kubernetes", [], ["context:work:api"]);
    expect(() => validateResumeAuditJson(audit, { publicMarkdown: markdown, publicArtifactName: audit.publicArtifact, snapshot: snapshot(), leanEvidenceMap: true }))
      .toThrow(ClaimValidationError);
  });
});

describe("skills spellings and activity words", () => {
  it("accepts a long name when its acronym is supported, and activity words around a supported term", () => {
    const { audit, markdown } = resume("**Engineering:** Representational State Transfer (REST), Python Debugging, Slack Automation", [], ["context:work:api", "context:work:agents"]);
    expect(check(audit, markdown)).toEqual([]);
  });

  it("still flags a product the evidence never names, even beside activity words", () => {
    const { audit, markdown } = resume("**Engineering:** Datadog Monitoring, Python", [], ["context:work:api"]);
    expect(check(audit, markdown)[0]?.message).toMatch(/Datadog Monitoring/);
  });
});

describe("named terms in framed lines", () => {
  it("ignores ordinary title case but flags a name borrowed from the posting", () => {
    const plain = resume("**Engineering:** Python", [["Configured Python REST API integrations as part of the Customer Success Program.", ["context:work:api"]]], ["context:work:api"]);
    expect(check(plain.audit, plain.markdown)).toEqual([]);
    const borrowed = resume("**Engineering:** Python", [["Configured Python REST API integrations and Grafana views for customer workflows.", ["context:work:api"]]], ["context:work:api"]);
    expect(check(borrowed.audit, borrowed.markdown)[0]?.message).toMatch(/Grafana/);
  });

  it("treats RESTful and REST as the same term", () => {
    const { audit, markdown } = resume("**Engineering:** RESTful APIs", [], ["context:work:api"]);
    expect(check(audit, markdown)).toEqual([]);
  });
});

describe("token matching", () => {
  it("matches plural and singular forms and checks a languages line as skills", () => {
    const { audit, markdown } = resume("**Engineering:** Python", [["Configured REST API integration processes in Python for customer workflow.", ["context:work:api"]]], ["context:work:api"]);
    expect(check(audit, markdown)).toEqual([]);
    const languages = resume("**Languages:** Esperanto", [], ["context:work:api"]);
    languages.audit.claimMappings[0].evidenceIds = [];
    expect(check(languages.audit, languages.markdown.replace("## Skills\n", "## Skills\n**Engineering:** Python\n"))[0]?.message).toMatch(/Esperanto/);
  });
});

describe("the pipeline skill tells Agy which row to cite", () => {
  it("keeps the cite-the-row-with-the-terms rule in the pipeline skill", async () => {
    const { readFile } = await import("node:fs/promises");
    const skill = await readFile(".agents/skills/jobsensei-application-pipeline/SKILL.md", "utf8");
    expect(skill).toMatch(/cite the row whose text contains the line's terms/);
    expect(skill).toMatch(/must appear in its cited rows/);
  });
});
