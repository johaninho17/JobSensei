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

  it("never feeds job-description text into the brief (letters must not lecture the employer)", () => {
    const rawJd = [
      "# Technical Support Engineer - Deliverability",
      "- Deliver responsive troubleshooting and solve complex deliverability issues for enterprise clients.",
      "- Partner with customers to improve inbox placement across regulated industries.",
    ].join("\n");
    const brief = buildCoverLetterBrief(rawJd, { title: "Technical Support Engineer - Deliverability", company: "Iterable" });
    expect(brief.roleProblems).toBeUndefined();
    const serialized = JSON.stringify(brief);
    expect(serialized).not.toContain("deliverability issues");
    expect(serialized).not.toContain("inbox placement");
    expect(brief.introContract?.join(" ")).toMatch(/never explain iterable's business/i);
  });

  it("reads the role from the JD heading when metadata has no title", () => {
    const brief = buildCoverLetterBrief("# Original Job Description\n\n# Solution Analyst III\n\n**Company:** Acme", { title: null, company: "Acme" });
    expect(brief.role).toBe("Solution Analyst III");
  });

  it("leads with the career story by default, at 200-280 words", () => {
    const brief = buildCoverLetterBrief("Build integrations.", { title: "Solutions Engineer", company: "Acme" });
    expect(brief.focus).toBe("career-story");
    expect(brief.structure).toHaveLength(4);
    expect(brief.structure?.[0]).toMatch(/applying for Solutions Engineer at Acme/);
    expect(brief.structure?.[1]).toMatch(/career story/i);
    expect(brief.structure?.[2]).toMatch(/how they work now/i);
    expect(brief.structure?.[2]).toMatch(/never a narrated scene/i);
    expect(brief.structure?.join(" ")).not.toMatch(/one or two concrete, evidence-backed examples/i);
    expect(brief.structure?.join(" ")).not.toMatch(/act\s*\d|3-act|4-act/i);
    expect([brief.targetWordMin, brief.targetWordMax, brief.hardWordMax]).toEqual([200, 280, 330]);
  });

  it("follows the candidate's own length and focus settings", () => {
    const brief = buildCoverLetterBrief("Build integrations.", { title: "Solutions Engineer", company: "Acme" }, {
      preferences: { coverLetter: { focus: "examples", length: { min: 150, max: 220 } } },
      truth: { confidentialNames: [] },
    } as never);
    expect(brief.focus).toBe("examples");
    expect(brief.structure).toHaveLength(3);
    expect(brief.structure?.[1]).toMatch(/one or two concrete, evidence-backed examples/i);
    expect([brief.targetWordMin, brief.targetWordMax, brief.hardWordMax]).toEqual([150, 220, 270]);
  });

  it("keeps every banned opener and the candidate's confidential client names in the prohibited list", () => {
    const brief = buildCoverLetterBrief("Build integrations.", { title: "Solutions Engineer", company: "Acme" }, {
      truth: { confidentialNames: ["Northwind Partners"] },
    } as never);
    expect(brief.requiredElements.join(" ")).toMatch(/by industry/i);
    for (const phrase of ["I am excited to apply", "I am interested in applying", "aligns perfectly", "I am drawn to the mission", "Acme's mission", "Northwind Partners"]) {
      expect(brief.prohibitedPatterns).toContain(phrase);
    }
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

describe("cover letter composition and public-file checks", () => {
  it("signs with the candidate's name, never the resume headline", async () => {
    const { coverLetterSignatureName } = await import("../electron/canonical-resume");
    expect(coverLetterSignatureName("**ALEX MORGAN — CUSTOMER SOLUTIONS ENGINEER**")).toBe("Alex Morgan");
    expect(coverLetterSignatureName("Alex Morgan | Solutions Engineer")).toBe("Alex Morgan");
    expect(coverLetterSignatureName("ALEX MORGAN — ENGINEER", "Alex Morgan")).toBe("Alex Morgan");
  });

  it("flags confidential client names in public files", async () => {
    const { confidentialNameIssues } = await import("../electron/application-validation");
    const issues = confidentialNameIssues(
      [
        { name: "resume.md", markdown: "- Led onboarding for Northwind Partners on a private AI platform." },
        { name: "cover_letter.md", markdown: "I helped a global professional-services firm adopt the platform." },
      ],
      ["Northwind Partners"],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "CONFIDENTIAL_NAME_PUBLIC", artifact: "resume.md" });
  });

  it("flags an opening sentence that lectures the employer instead of describing the candidate", async () => {
    const { openingSentencesNotAboutCandidate } = await import("../electron/application-validation");
    const lecturing = "I am applying for the Analyst role at Acme. In enterprise platform delivery, projects stall most often when operational requirements fail to account for integration contracts and readiness. That gap is where I work best.";
    expect(openingSentencesNotAboutCandidate(lecturing)).toHaveLength(1);
    const personal = "I am applying for the Analyst role at Acme. I started as a backend developer and moved into customer work because I wanted to see how my systems held up with real users. Acme's onboarding work is close to what I do every day.";
    expect(openingSentencesNotAboutCandidate(personal)).toHaveLength(0);
  });
});

describe("story-led letters", () => {
  it("flags letters whose body is told as scenes, not as a career story", async () => {
    const { scenarioParagraphs } = await import("../electron/application-validation");
    const scenes = [
      "I am applying for the Solutions Consultant role at Acme. I moved from back-end development into customer work.",
      "At Northstar Labs, I ran data discovery with a research client whose records sat in spreadsheets. I explained when documents belonged in search and when in fine-tuning.",
      "When a consulting partner was unsure what our platform could do, I kept both sides aligned and wrote their enablement guide.",
      "Thank you for your time. I would welcome a conversation.",
    ];
    expect(scenarioParagraphs(scenes)).toEqual([1, 2]);
    const story = [
      "I am applying for the Solutions Consultant role at Acme. I started as a back-end developer and now work with customers every day.",
      "I spent my first years writing services nobody outside the team saw. I wanted to be the person who explains the system to the people who use it, so I moved into customer onboarding, even though it meant being uncomfortable.",
      "Today I guide customers from setup to go-live at Northstar Labs and stay with a problem until it is solved, working with our engineers when it needs a fix.",
      "Thank you for your time. I would welcome a conversation.",
    ];
    expect(scenarioParagraphs(story)).toEqual([]);
  });

  it("uses the candidate's hard word limit when it is set", async () => {
    const { validateApplicationArtifact } = await import("../electron/application-artifacts");
    const letter = ["Dear Hiring Team,", "", Array.from({ length: 300 }, () => "word").join(" "), "", "Sincerely,", "Alex Morgan"].join("\n");
    expect(() => validateApplicationArtifact(letter, "cover-letter", { letterHardWordMax: 250 })).toThrow(/hard limit is 250/);
    expect(() => validateApplicationArtifact(letter, "cover-letter", { letterHardWordMax: 400 })).not.toThrow();
  });
});
