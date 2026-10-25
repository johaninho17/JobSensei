import { describe, expect, it } from "vitest";
import { extractRequiredItems, extractResponsibilityItems } from "../electron/fit-scoring";

// Fictional postings in the heading styles of common applicant-tracking systems.
const POSTINGS: Record<string, string> = {
  bank: [
    "# Software Engineer III - Platform",
    "## Job Description",
    "As a Software Engineer III you deliver secure, stable technology.",
    "### Job Responsibilities",
    "- Design, code, test, and deliver platform workflows.",
    "- Troubleshoot production issues.",
    "### Required Qualifications, Capabilities, and Skills",
    "- 3+ years applied experience",
    "- Hands-on platform implementation experience",
    "- Proficiency in JavaScript and SQL",
    "### Preferred Qualifications, Capabilities, and Skills",
    "- Experience with portal development",
  ].join("\n"),
  workday: [
    "Data Analyst",
    "Key Responsibilities:",
    "- Build weekly dashboards",
    "- Clean CRM data",
    "Qualifications",
    "Basic Qualifications:",
    "- Bachelor's degree or equivalent experience",
    "- 2+ years of SQL",
    "Preferred Qualifications:",
    "- Tableau certification",
  ].join("\n"),
  greenhouse: [
    "## About the Role",
    "You will join a small team.",
    "## What You'll Do",
    "- Onboard new customers",
    "- Run kickoff calls",
    "## What You'll Bring",
    "- 3+ years in customer success",
    "- Comfort with REST APIs",
    "## Nice to Have",
    "- Salesforce admin experience",
  ].join("\n"),
  lever: [
    "**Responsibilities**",
    "- Own the renewal pipeline",
    "**Requirements**",
    "- 4+ years of B2B sales",
    "- Experience with HubSpot",
    "**Bonus points**",
    "- Spanish",
  ].join("\n"),
  ashby: [
    "### In this role you will",
    "- Ship product features end to end",
    "### You might be a great fit if",
    "- You have shipped React apps in production",
    "- You write clear specs",
    "### Benefits",
    "- Health insurance",
  ].join("\n"),
};

describe("JD sections are found by meaning across ATS formats", () => {
  it("bank-style headings with long names", () => {
    expect(extractRequiredItems(POSTINGS.bank!)).toEqual(["3+ years applied experience", "Hands-on platform implementation experience", "Proficiency in JavaScript and SQL"]);
    expect(extractResponsibilityItems(POSTINGS.bank!)).toEqual(["Design, code, test, and deliver platform workflows.", "Troubleshoot production issues."]);
  });
  it("Workday-style plain-line headings with sub-headings", () => {
    expect(extractRequiredItems(POSTINGS.workday!)).toEqual(["Bachelor's degree or equivalent experience", "2+ years of SQL"]);
    expect(extractResponsibilityItems(POSTINGS.workday!)).toEqual(["Build weekly dashboards", "Clean CRM data"]);
  });
  it("Greenhouse, Lever, and Ashby styles, never counting nice-to-haves or benefits", () => {
    expect(extractRequiredItems(POSTINGS.greenhouse!)).toEqual(["3+ years in customer success", "Comfort with REST APIs"]);
    expect(extractResponsibilityItems(POSTINGS.greenhouse!)).toEqual(["Onboard new customers", "Run kickoff calls"]);
    expect(extractRequiredItems(POSTINGS.lever!)).toEqual(["4+ years of B2B sales", "Experience with HubSpot"]);
    expect(extractRequiredItems(POSTINGS.ashby!)).toEqual(["You have shipped React apps in production", "You write clear specs"]);
    expect(extractResponsibilityItems(POSTINGS.ashby!)).toEqual(["Ship product features end to end"]);
  });
});

describe("job identity", () => {
  it("takes the title from the posting heading so same-company jobs stay distinct", async () => {
    const { parseJobDescriptionMetadata } = await import("../electron/job-description");
    const a = parseJobDescriptionMetadata("# Software Engineer III - Platform\n\n**Company:** Northstar Bank  \n");
    const b = parseJobDescriptionMetadata("# Solution Analyst III - Platform\n\n**Company:** Northstar Bank  \n");
    expect(a.company).toBe("Northstar Bank");
    expect(a.title).toBe("Software Engineer III - Platform");
    expect(b.title).not.toBe(a.title);
    expect(parseJobDescriptionMetadata("# Job Description\n\nJob Title: Analyst").title).toBe("Analyst");
  });
});

describe("job actions name the exact job", () => {
  it("gives two same-company jobs different prompts that carry the job ID", async () => {
    const { buildJobActions } = await import("../src/renderer/job-actions");
    const base = { relativePath: "jobs/x", name: "x", company: "Northstar Bank", createdAt: "2026-10-25T00:00:00Z", modifiedAt: "2026-10-25T00:00:00Z", artifactCount: 1, applicationStage: null, rating: null } as never;
    const a = buildJobActions({ ...(base as object), id: "northstar-bank-swe-iii", title: "Software Engineer III" } as never, null, null);
    const b = buildJobActions({ ...(base as object), id: "northstar-bank-analyst-iii", title: "Solution Analyst III" } as never, null, null);
    expect(a[0]!.prompt).toBe("Prepare Northstar Bank Software Engineer III recruiter interview (job: northstar-bank-swe-iii)");
    expect(b[0]!.prompt).toContain("(job: northstar-bank-analyst-iii)");
  });
});

describe("title fallback never reads evaluation headings", () => {
  it("ignores '# Application Evaluation' as a job title", async () => {
    const { parseJobDescriptionMetadata } = await import("../electron/job-description");
    expect(parseJobDescriptionMetadata("# Application Evaluation\n\n- score", { headingFallback: false }).title).toBeNull();
    expect(parseJobDescriptionMetadata("# Application Evaluation\n").title).toBeNull();
  });
});
