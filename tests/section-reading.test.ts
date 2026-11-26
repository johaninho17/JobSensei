// Issue #173: header facts are never section headings; bold paragraphs inside a requirements list are items; explicit
// duty headings beat "About the role"; "Job Description" bullets are duties when nothing else is. Fictional postings.
import { describe, expect, it } from "vitest";
import { extractRequiredItems, extractResponsibilityItems } from "../electron/fit-scoring";
import { buildPostingRecord } from "../electron/posting-record";

const header = "# Solutions Engineer\n\n**Company:** Northwind  \n**Location:** Remote  \n**Work setup:** Remote  \n**Pay:** $120,000–$150,000/year  \n**Source:** https://jobs.example.com/1\n\n";

describe("section reading", () => {
  it("keeps the role overview in the summary when the header states pay and work setup", () => {
    const record = buildPostingRecord(`${header}Northwind is the platform for planning shared fleets across many cities.\n\nAs a Solutions Engineer at Northwind, you will guide customers from first demo to a working rollout.\n\n## Requirements\n- 3+ years in a customer-facing technical role\n`);
    expect(record.summary[0]).toMatch(/^As a Solutions Engineer/);
    expect(record.summary.join(" ")).not.toMatch(/platform for planning/);
  });

  it("reads a bold paragraph inside a requirements list as an item and keeps reading after it", () => {
    const posting = `${header}## What you'll bring\n- **Systems thinking -** You map how data moves between the tools a business runs and spot where it breaks.\n\n**Hands-on building skills - You can write and ship working integrations in a common language and debug them in production, specifically:**\n- **Prompt design:** writing and testing system prompts for support workflows.\n- **Evaluation:** measuring output quality against a labeled set before rollout.\n\n## Benefits\n- Health insurance\n`;
    const items = extractRequiredItems(posting);
    expect(items).toHaveLength(4);
    expect(items[1]).toMatch(/^Hands-on building skills/);
    expect(items[3]).toMatch(/^Evaluation:/);
  });

  it("takes duties from an explicit heading over an About the role overview", () => {
    const posting = `${header}## About the Role\n\nThe platform team keeps Northwind's systems fast and safe.\nOur work centers on three areas:\n- Reliability\n- Cost\n- Security\n\nWhat You'll Do\n- Run the quarterly capacity review\n- Design alerting for the planning service\n\n## What You Need\n- 5 years building software\n`;
    expect(extractResponsibilityItems(posting)).toEqual(["Run the quarterly capacity review", "Design alerting for the planning service"]);
  });

  it("reads bullets under a Job Description heading and its Activities sub-heading as duties", () => {
    const posting = `${header}## Job Description\n\nThe developer builds and maintains web applications.\nActivities\n- Build frontend and backend components\n- Review code and mentor new developers\n\n## Qualifications\n- 3 years of full stack work\n`;
    expect(extractResponsibilityItems(posting)).toEqual(["Build frontend and backend components", "Review code and mentor new developers"]);
    const noSubheading = `${header}## Job Description\n\nThe developer builds web applications.\n- Build frontend components\n- Fix production issues\n\n## Qualifications\n- 3 years of full stack work\n`;
    expect(extractResponsibilityItems(noSubheading)).toEqual(["Build frontend components", "Fix production issues"]);
  });
});
