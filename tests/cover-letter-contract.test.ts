import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCoverLetterBrief } from "../electron/evidence-snapshot";

const root = process.cwd();

describe("cover letter brief and guidance contract", () => {
  it("falls back to canonicalJob metadata when job description has no explicit title/company header", () => {
    const rawJd = [
      "# Technical Support Engineer - Deliverability",
      "",
      "We are seeking an engineer to support client email delivery and troubleshoot SMTP errors.",
    ].join("\n");

    const brief = buildCoverLetterBrief(rawJd, {
      title: "Technical Support Engineer - Deliverability",
      company: "Iterable",
    });

    expect(brief.role).toBe("Technical Support Engineer - Deliverability");
    expect(brief.company).toBe("Iterable");
  });

  it("cleans roleProblems by stripping markdown headings and filtering out ceremonies and role titles", () => {
    const rawJd = [
      "# Technical Support Engineer - Deliverability",
      "## About Iterable",
      "We are a high-growth customer engagement platform with a medical, dental, and 401(k) package.",
      "- Deliver responsive troubleshooting and solve complex deliverability issues for enterprise clients.",
      "- Raise blockers promptly during daily sprint ceremonies and standups.",
    ].join("\n");

    const brief = buildCoverLetterBrief(rawJd, {
      title: "Technical Support Engineer - Deliverability",
      company: "Iterable",
    });

    expect(brief.roleProblems).toBeDefined();
    expect(brief.roleProblems.length).toBeLessThanOrEqual(1);
    for (const problem of brief.roleProblems) {
      expect(problem.startsWith("#")).toBe(false);
      expect(problem).not.toContain("401(k)");
      expect(problem).not.toContain("sprint ceremonies");
      expect(problem.toLowerCase()).not.toContain("iterable");
      expect(problem.toLowerCase()).not.toContain("technical support engineer - deliverability");
    }
    expect(brief.roleProblems[0]).toContain("Deliver responsive troubleshooting and solve complex deliverability issues for enterprise clients.");
  });

  it("includes prohibited template formulas in prohibitedPatterns", () => {
    const brief = buildCoverLetterBrief("Build and support backend data pipelines.", {
      title: "Solutions Engineer",
      company: "Acme",
    });

    const prohibited = brief.prohibitedPatterns;
    expect(prohibited).toContain("Throughout my work, I have focused");
    expect(prohibited).toContain("Throughout my work, I have concentrated");
    expect(prohibited).toContain("making this position a natural continuation");
    expect(prohibited).toContain("making this role a natural next step");
    expect(prohibited).toContain("a natural continuation");
    expect(prohibited).toContain("That background allows me to");
    expect(prohibited).toContain("I look forward to bringing");
    expect(prohibited).toContain("As Acme");
    expect(prohibited).toContain("Acme's mission");
  });

  it("enforces candidate-first narrative and prevents JD-derived motivation across pipeline and writer skills", async () => {
    const [pipeline, writer, contract] = await Promise.all([
      readFile(join(root, ".agents/skills/jobsensei-application-pipeline/SKILL.md"), "utf8"),
      readFile(join(root, ".agents/skills/jobsensei-application-writer/SKILL.md"), "utf8"),
      readFile(join(root, ".agents/skills/jobsensei-application-pipeline/references/workflow-contract.md"), "utf8"),
    ]);

    // Pipeline skill assertions
    expect(pipeline).toMatch(/candidate-first/i);
    expect(pipeline).toMatch(/candidate profile|candidateProfile/i);
    expect(pipeline).toContain("The JD identifies what to prioritize; it never proves that the candidate performed it.");

    // Writer skill assertions
    expect(writer).toMatch(/candidate-first/i);
    expect(writer).toMatch(/candidate profile|candidateProfile/i);
    expect(writer).toMatch(/non-factual.*invent|never invent/is);

    // Workflow contract assertions
    expect(contract).toMatch(/candidate-first/i);
    expect(contract).toMatch(/candidate/i);
  });
});
