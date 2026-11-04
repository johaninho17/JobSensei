import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanPosting, formQuestionLines, postingUrl, splitPageTitle } from "../electron/posting-clean";
import { loadStagedJobDescription, setStagedCompany, stageLinkJobDescription, stagePastedJobDescription } from "../electron/jd-fetch";
import { completeFallbackTable, jobRequirements, scoreEvaluation } from "../electron/fit-scoring";

// Fictional postings in the shapes seen on 2026-10-28/29: a bank career page copied as plain text (no employer
// named, a business-unit line), a Lever apply page with the form in it, and a heading with an invisible character.
const BANK_PASTE = `Software Engineer [Multiple Positions Available]
Palo Alto, CA, United States
APPLY NOW
JOB INFORMATION

Job Identification
210000001
Job Category
Software Engineering
Business Unit
Consumer Banking
Base Pay/Salary
Palo Alto,CA $150,000.00
JOB DESCRIPTION

DESCRIPTION:
Duties: Build secure web applications in React and TypeScript for internal teams. Review code, set engineering standards, and improve accessibility across products used by many teams every day.
QUALIFICATIONS:
- Bachelor's degree in Computer Science plus five years of experience as a software engineer.
- Three years of experience with React, TypeScript, and automated testing with Jest and Cypress.
`;

const APPLY_PAGE = `# Northstar Labs - Support Engineer

**Source:** https://jobs.lever.co/northstar/abc-123

## Support Engineer

Help customers get value from Northstar's data platform. You will troubleshoot integrations, write clear guides, and work with engineering on fixes. ${"You will own customer issues end to end and keep them informed. ".repeat(6)}

### Submit your application
Full name ✱
### Visa Status
- Are you authorized to work in the United States? ✱
### Role Specific Questions
- Tell us about a customer outcome you delivered in your most recent role. What did you do? ✱
`;

describe("posting cleanup", () => {
  it("formats a plain paste: header, headings, label/value lines, no buttons", () => {
    const { markdown, form } = cleanPosting(BANK_PASTE, { title: "Software Engineer [Multiple Positions Available]", company: "Northstar Bank", location: null, source: "pasted" });
    expect(markdown.startsWith("# Software Engineer [Multiple Positions Available]\n\n**Company:** Northstar Bank")).toBe(true);
    expect(markdown).toContain("**Source:** pasted");
    expect(markdown).toContain("## Job information");
    expect(markdown).toContain("**Job Category:** Software Engineering");
    expect(markdown).toContain("**Business Unit:** Consumer Banking");
    expect(markdown).toContain("## Qualifications");
    expect(markdown).not.toMatch(/APPLY NOW/);
    expect(markdown.match(/Software Engineer \[Multiple/g)).toHaveLength(1);
    expect(form).toBeNull();
    expect(jobRequirements(markdown).filter((requirement) => requirement.kind === "required")).toHaveLength(2);
  });

  it("splits the application form off the posting and keeps its question lines", () => {
    const { markdown, form } = cleanPosting(APPLY_PAGE, { title: null, company: null, location: null, source: "https://jobs.lever.co/northstar/abc-123" });
    expect(markdown).toContain("Help customers get value");
    expect(markdown).not.toMatch(/Submit your application|authorized to work|customer outcome/);
    expect(formQuestionLines(form!)).toEqual([
      "Are you authorized to work in the United States?",
      "Tell us about a customer outcome you delivered in your most recent role. What did you do?",
    ]);
  });

  it("removes invisible characters so headings are recognized", () => {
    const posting = `# Engineer\n\n**Source:** pasted\n\nKey R͏esponsibilities\n- Deploy the platform in customer environments and support integrations with client systems.\n- Troubleshoot implementation issues with customer teams.\n`;
    const { markdown } = cleanPosting(posting, { title: "Engineer", company: null, location: null, source: "pasted" });
    expect(markdown).toContain("Key Responsibilities");
    expect(jobRequirements(markdown).length).toBeGreaterThan(0);
  });

  it("turns apply-page links into the posting and splits board page titles", () => {
    expect(postingUrl("https://jobs.lever.co/northstar/abc-123/apply?lever-source=x")).toBe("https://jobs.lever.co/northstar/abc-123?lever-source=x");
    expect(postingUrl("https://jobs.ashbyhq.com/northstar/abc-123/application")).toBe("https://jobs.ashbyhq.com/northstar/abc-123");
    expect(postingUrl("https://job-boards.greenhouse.io/northstar/jobs/1#app")).toBe("https://job-boards.greenhouse.io/northstar/jobs/1");
    expect(splitPageTitle("Job Application for Data Analyst (Entry-Level) at Northstar Labs")).toEqual({ title: "Data Analyst (Entry-Level)", company: "Northstar Labs" });
  });
});

describe("staging", () => {
  it("saves a cleaned paste with its form apart, and the company the user names", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-clean-"));
    const meta = await stagePastedJobDescription(root, BANK_PASTE, "paste-bank-1");
    expect(meta.company).toBeNull();
    const named = await setStagedCompany(root, "paste-bank-1", "Northstar Bank");
    expect(named).toMatchObject({ company: "Northstar Bank", suggestedJobId: "northstar-bank-software-engineer-multiple-positions-available" });
    const { markdown } = await loadStagedJobDescription(root, "paste-bank-1");
    expect(markdown).toMatch(/^# Software Engineer \[Multiple Positions Available\]\n\n\*\*Company:\*\* Northstar Bank {2}\n/);
    await stagePastedJobDescription(root, APPLY_PAGE, "paste-apply-1");
    await loadStagedJobDescription(root, "paste-apply-1");
    expect(await readFile(join(root, ".sensei", "fetched_form.md"), "utf8")).toMatch(/customer outcome/);
    expect(await readFile(join(root, ".sensei", "fetched_jd.md"), "utf8")).not.toMatch(/customer outcome/);
    await expect(stagePastedJobDescription(root, `### Submit your application\n${"- Are you authorized to work in the United States? ✱\n".repeat(12)}`, "paste-form-1")).rejects.toThrow(/application form/);
  });

  it("fetches the posting, not the apply page, for an apply link", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-clean-"));
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      return new Response(`<html><title>Northstar Labs - Support Engineer</title><body><h2>Support Engineer</h2><p>${"Help customers get value from the platform. ".repeat(20)}</p></body></html>`);
    }) as unknown as typeof fetch;
    await stageLinkJobDescription(root, "https://jobs.lever.co/northstar/abc-123/apply", "paste-link-1", fetcher);
    expect(asked).toEqual(["https://jobs.lever.co/northstar/abc-123"]);
  });
});

describe("fallback rating table", () => {
  it("scores the short table the model writes when the posting had no requirement sections", () => {
    const evaluation = `# Application Evaluation\n\n### Requirement Scoring\n| Requirement | Category | Classification | Evidence | Blocker |\n| --- | --- | --- | --- | --- |\n| Customer engineering | core | direct | context:a | |\n| API integrations | technical | strong_transferable | context:b | |\n| Ownership | scope | adjacent_transferable | context:c | |\n| Go-lives | outcomes | direct | context:d | |\n| Data platforms | domain | gap | | |\n| AI tooling | learning | direct | context:e | |\n`;
    expect(completeFallbackTable(evaluation)).toMatch(/\| Requirement \| Category \| Weight \| Material \|/);
    const result = scoreEvaluation(evaluation);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(3);
    expect(result!.score).toBeLessThan(5);
  });
});
