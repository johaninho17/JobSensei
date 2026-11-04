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
  // Copied from a career site that renders lists without bullet markers.
  plainLines: [
    "Solution Analyst III - Platform",
    "San Francisco, CA",
    "Job responsibilities",
    "Translate business needs into clear requirements for engineering.",
    "Build dashboards that track delivery progress",
    "Required Qualifications, Capabilities, and Skills ",
    "3+ years of experience in solutions analysis or a related field.",
    "Strong knowledge of Jira, including building dashboards.",
    "Proficiency in SQL",
    "Excellent communication with diverse audiences.",
    "Preferred Qualifications, Capabilities, and Skills ",
    "Experience with the Northstar platform.",
    "About Northstar Bank",
    "We serve millions of customers.",
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
  it("plain-line lists without bullet markers, stopping at the preferred section", () => {
    expect(extractRequiredItems(POSTINGS.plainLines!)).toEqual(["3+ years of experience in solutions analysis or a related field.", "Strong knowledge of Jira, including building dashboards.", "Proficiency in SQL"]);
    expect(extractResponsibilityItems(POSTINGS.plainLines!)).toEqual(["Translate business needs into clear requirements for engineering.", "Build dashboards that track delivery progress"]);
  });

  it("recognizes common wording for the requirements heading", () => {
    for (const heading of ["## Ideal Candidates Have", "## We're looking for someone who has:", "## You should apply if:", "## Your background"]) {
      expect(extractRequiredItems(`# Analyst\n${heading}\n- 2+ years of SQL\n## Benefits\n- Health plan`), heading).toEqual(["2+ years of SQL"]);
    }
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

describe("fetched pages that end with an application form", () => {
  it("reads a glued heading as the requirements and never the form's fields", async () => {
    const { extractRequiredItems, extractResponsibilityItems } = await import("../electron/fit-scoring");
    const page = [
      "## Support Analyst",
      "### **What You’ll DoCustomer Work**",
      "- Help customers fix failing data imports",
      "### **Who You AreQualifications**",
      "- 2+ years supporting technical customers",
      "- Fluency in SQL",
      "### **Nice to Have**",
      "- Snowflake experience",
      "## Apply for this job",
      "*",
      "indicates a required field",
      "Autofill my application",
      "First Name *",
      "Email *",
      "Resume/CV *",
      "Dropbox",
    ].join("\n");
    expect(extractRequiredItems(page)).toEqual(["2+ years supporting technical customers", "Fluency in SQL"]);
    expect(extractResponsibilityItems(page)).toEqual(["Help customers fix failing data imports"]);
  });
});

describe("requirement edge cases from real postings (fictional text)", () => {
  it("splits a long semicolon list of required skills and drops location and pay lines", () => {
    const jd = [
      "# Software Engineer",
      "## Description",
      "Duties: Build secure web applications for internal teams. Review code and mentor engineers on testing. Work with product managers to plan releases.",
      "## Qualifications",
      "Minimum education and experience required: Bachelor's degree in Computer Science plus three years of experience as a Software Engineer.",
      "Skills Required: This position requires three years of experience with the following: Designing accessible web applications using React and TypeScript; Coordinating cross-functional teams and leading code reviews for a design system; Building CI pipelines with automated tests.",
      "Job Location: 100 Main St, Springfield.",
      "Full-Time. Salary: $150,000.00 per year.",
    ].join("\n");
    expect(extractRequiredItems(jd)).toEqual([
      "Minimum education and experience required: Bachelor's degree in Computer Science plus three years of experience as a Software Engineer.",
      "Designing accessible web applications using React and TypeScript",
      "Coordinating cross-functional teams and leading code reviews for a design system",
      "Building CI pipelines with automated tests.",
    ]);
    expect(extractResponsibilityItems(jd)).toEqual([
      "Build secure web applications for internal teams.",
      "Review code and mentor engineers on testing.",
      "Work with product managers to plan releases.",
    ]);
  });

  it("adds skill groups under unnamed headings and drops benefit labels in the qualifications list", () => {
    const jd = [
      "# Forward Deployed Engineer",
      "Key Responsibilities",
      "Deployment Support:",
      "- Configure the platform in customer environments",
      "Deployment & Integration",
      "- Programming experience in Python or JavaScript",
      "- Familiarity with databases (SQL or NoSQL)",
      "- Exposure to cloud platforms",
      "Operational & Professional Skills",
      "- Version control basics (Git)",
      "- Clear written and verbal communication",
      "Soft Skills",
      "- Curiosity and willingness to learn",
      "- Demonstrated teamwork and leadership abilities",
      "Qualifications",
      "- Recent graduate of a Computer Science program",
      "- 0–2 years of experience in implementation roles",
      "- Training & Development",
      "- Work From Home",
    ].join("\n");
    expect(extractRequiredItems(jd)).toEqual([
      "Recent graduate of a Computer Science program",
      "0–2 years of experience in implementation roles",
      "Programming experience in Python or JavaScript",
      "Familiarity with databases (SQL or NoSQL)",
      "Exposure to cloud platforms",
      "Version control basics (Git)",
    ]);
  });
});
