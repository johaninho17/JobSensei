import { describe, expect, it } from "vitest";
import { roleFacts } from "../electron/role-facts";

const POSTING = [
  "# Support Analyst",
  "**Company:** Northstar Labs  ",
  "**Location:** Portland, OR  ",
  "**Source:** https://jobs.example.com/northstar/123",
  "",
  "Northstar Labs builds data tools that help small clinics keep patient imports clean. We are a team of 40.",
  "",
  "## What you'll do",
  "- Help customers fix failing data imports.Write the fix up afterwards.",
  "- Write clear troubleshooting guides",
  "",
  "## Requirements",
  "- 3+ years supporting technical customers",
  "- Fluency in SQL",
  "",
  "This role is hybrid, three days a week in our Portland office.",
  "The pay range is $90,000 - $110,000 a year.",
  "",
  "## Apply for this job",
  "First Name *",
].join("\n");

const RESEARCH = [
  "## The role decoded",
  "- Fixes customer imports end to end (source: original_jd.md)",
  "- Writes the guides support uses (S1)",
  "## Pay",
  "- $90,000 - $110,000 a year (source: original_jd.md)",
  "## What they sell and who buys it",
  "Northstar sells import-cleaning software to small clinics (source: https://example.com/product).",
  "## Interview process",
  "- Recruiter call, then a hiring manager call (https://example.com/careers, accessed 2026-10-26)",
].join("\n");

describe("role facts for the Overview", () => {
  it("reads responsibilities, experience, arrangement, pay, company, and source from the posting alone", () => {
    const facts = roleFacts(POSTING);
    expect(facts.summary).toEqual([]);
    expect(facts.responsibilities).toEqual(["Help customers fix failing data imports. Write the fix up afterwards.", "Write clear troubleshooting guides"]);
    expect(facts).toMatchObject({ requiredCount: 2, experience: "3+ years", pay: "$90,000–$110,000/year", source: "https://jobs.example.com/northstar/123" });
    expect(facts.payRange).toEqual({ min: 90000, max: 110000, currency: "USD", period: "year" });
    expect(facts.workArrangement).toMatch(/hybrid, three days a week/);
    expect(facts.workMode).toBe("hybrid");
    expect(facts.missing).toEqual(["summary"]);
    expect(facts.company).toBe("Northstar Labs builds data tools that help small clinics keep patient imports clean.");
  });

  it("prefers the company research for the summary, company line, pay, and process, without IDs or source notes", () => {
    const facts = roleFacts(POSTING, RESEARCH);
    expect(facts.summary).toEqual(["Fixes customer imports end to end", "Writes the guides support uses"]);
    expect(facts.company).toBe("Northstar sells import-cleaning software to small clinics");
    expect(facts.pay).toBe("$90,000 - $110,000 a year");
    expect(facts.process).toEqual(["Recruiter call, then a hiring manager call"]);
  });
});

describe("plain pasted postings (no headings, labels with colons)", () => {
  const PASTE = [
    "Customer Solutions Engineer",
    "",
    "A fantastic opportunity for a Customer Solutions Engineer has arisen within a growing software company, with positions in Portland and Denver.",
    "",
    "Location: Portland or Denver – 3 days in the office, 2 days remote",
    "",
    "Salary: $75,000–$80,000 for graduates; $115,000–$150,000 for experienced candidates, + bonus",
    "",
    "Requirements for Customer Solutions Engineer:",
    "At least 2 years of experience working for a SaaS company is essential.",
    "Strong programming skills in JavaScript or Python.",
    "Previous customer-facing technical experience is preferred.",
    "Relevant internships are advantageous for graduates.",
    "",
    "Responsibilities for Customer Solutions Engineer:",
    "Support pre-sales demonstrations of the platform.",
    "Build integrations with business applications.",
    "",
    "What the role offers:",
    "Excellent training and career progression.",
    "Benefits including medical, dental, and a 401(k).",
    "",
    "Applications:",
    "If you would like to apply, please send your CV through the relevant link!",
    "We're committed to an inclusive and accessible recruitment process.",
  ].join("\n");

  it("takes the title from the first line, not the opening paragraph", async () => {
    const { parseJobDescriptionMetadata } = await import("../electron/job-description");
    expect(parseJobDescriptionMetadata(PASTE).title).toBe("Customer Solutions Engineer");
    expect(parseJobDescriptionMetadata("A fantastic opportunity has arisen.\nMore text").title).toBeNull();
  });

  it("stops responsibilities at the next section, drops preferred items, and keeps whole lines for work and pay", async () => {
    const { extractRequiredItems, extractResponsibilityItems } = await import("../electron/fit-scoring");
    expect(extractResponsibilityItems(PASTE)).toEqual(["Support pre-sales demonstrations of the platform.", "Build integrations with business applications."]);
    expect(extractRequiredItems(PASTE)).toEqual(["At least 2 years of experience working for a SaaS company is essential.", "Strong programming skills in JavaScript or Python."]);
    const facts = roleFacts(PASTE);
    expect(facts.workArrangement).toBe("Hybrid: Portland or Denver – 3 days in the office, 2 days remote");
    expect(facts.pay).toBe("$75,000–$80,000 for graduates; $115,000–$150,000 for experienced candidates, + bonus");
    expect(facts.company).toBeNull();
  });
});
