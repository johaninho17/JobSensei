import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPostingRecord, parsePay, parseWorkSetup, POSTING_PARSER_VERSION, POSTING_RECORD_FILE, readPostingRecord, seniorityOf } from "../electron/posting-record";
import { postingRecordSchema } from "../src/shared/posting";

// Golden postings, one per layout seen on real boards. Fictional companies only.

/** Bold ALL-CAPS headings, a "looking for" heading over paragraphs, perks under "what you can expect", a #LI- tag. */
const BOLD_CAPS = [
  "# Solutions Consultant",
  "",
  "**Company:** Northstar Labs  ",
  "**Source:** https://job-boards.greenhouse.io/northstar/jobs/123",
  "",
  "**WHAT WE'RE LOOKING FOR**",
  "",
  "Northstar Labs is looking to hire a Solutions Consultant for our mid-market segment. Consultants are trusted advisors to prospective customers during the sales process, bringing product expertise and best practices to bear.",
  "",
  "Consultants blend storytelling with the detail of how the product delivers value. During the sales process we help make it real, building customer confidence in the platform and the team.",
  "",
  "The role requires some travel, at most 30% at peak times.",
  "",
  "**WHAT YOU CAN EXPECT**",
  "- Early access to new product capabilities",
  "- Full support from teammates across departments",
  "",
  "**WHO YOU ARE**",
  "- You have experience selling into accounts with a pre-sales consulting team.",
  "- You have domain knowledge of two or more of the following: AI, SaaS, APIs, or Programming (even just HTML)",
  "",
  "For candidates based in the United States, the pay range is expected to be between $83,000 and $116,000/year, with OTE between $118,500 and $150,500/year.",
  "",
  "#LI-Hybrid",
  "",
  "**WHAT WE OFFER**",
  "- Flexible paid time off",
  "- A curated in-office employee experience",
  "",
  "**ABOUT NORTHSTAR LABS**",
  "Northstar Labs builds data tools that help small clinics keep patient imports clean.",
  "",
  "**NORTHSTAR LABS IS AN EQUAL OPPORTUNITY EMPLOYER**",
  "We value diversity.",
].join("\n");

/** Markdown headings, labeled location, remote, preferred section, years of experience. */
const MARKDOWN = [
  "# Senior Support Engineer",
  "**Company:** Northstar Labs  ",
  "**Location:** Remote (US)  ",
  "**Source:** https://jobs.lever.co/northstar/abc",
  "",
  "## About the role",
  "You will be the technical voice of support for our largest customers, owning escalations from first report to fix.",
  "",
  "## What you'll do",
  "- Debug failing data imports with customers",
  "- Write troubleshooting guides",
  "",
  "## Requirements",
  "- 5+ years supporting technical customers",
  "- Fluency in SQL and PostgreSQL",
  "- Must be authorized to work in the US; we do not offer visa sponsorship.",
  "",
  "## Nice to have",
  "- Experience with dbt",
  "",
  "## Compensation",
  "- Salary: $140k – $165k",
].join("\n");

/** A plain paste: no headings, labels with colons, hourly pay, days in office. */
const PLAIN = [
  "Implementation Specialist",
  "Northstar Labs",
  "Location: Denver, CO",
  "Work model: three days a week in our Denver office, two remote",
  "Pay: $32 - $38 per hour",
  "",
  "Responsibilities:",
  "Configure customer accounts during onboarding",
  "Run training sessions for new admins",
  "Requirements:",
  "At least 2 years of customer onboarding experience",
  "Comfort with spreadsheets and CSV imports",
].join("\n");

describe("posting record: golden postings", () => {
  it("bold ALL-CAPS layout: paragraphs under 'looking for' are the role overview, not requirements", () => {
    const record = buildPostingRecord(BOLD_CAPS);
    expect(postingRecordSchema.safeParse(record).success).toBe(true);
    expect(record).toMatchObject({ title: "Solutions Consultant", company: "Northstar Labs", board: "greenhouse" });
    expect(record.summary[0]).toMatch(/^Northstar Labs is looking to hire a Solutions Consultant/);
    expect(record.requiredItems).toEqual([
      "You have experience selling into accounts with a pre-sales consulting team.",
      "You have domain knowledge of two or more of the following: AI, SaaS, APIs, or Programming (even just HTML)",
    ]);
    expect(record.requirements.map((item) => item.id)).toEqual(["req:1", "req:2"]);
    expect(record.benefits).toContain("Early access to new product capabilities");
    expect(record.pay).toMatchObject({ text: "$83,000–$116,000/year", min: 83000, max: 116000, currency: "USD", period: "year" });
    // The board's tag sets the mode; the perks bullet "in-office employee experience" is not the work setup.
    expect(record.workSetup).toEqual({ mode: "hybrid", daysInOffice: null, text: "Hybrid" });
    expect(record.travel).toBe("The role requires some travel, at most 30% at peak times.");
    expect(record.companyLine).toBe("Northstar Labs builds data tools that help small clinics keep patient imports clean.");
    expect(record.tools.map((tool) => tool.name)).toEqual(["AI", "SaaS", "API", "HTML"]);
    expect(record.tools[0]!.requirementIds).toEqual(["req:2"]);
    expect(record.missing).toEqual(["location", "responsibilities", "experience"]);
  });

  it("markdown layout: sections, remote, preferred, authorization, labeled pay, seniority", () => {
    const record = buildPostingRecord(MARKDOWN);
    expect(record).toMatchObject({ location: "Remote (US)", board: "lever", experience: "5+ years", seniority: "senior" });
    expect(record.summary).toEqual(["You will be the technical voice of support for our largest customers, owning escalations from first report to fix."]);
    expect(record.responsibilities).toEqual(["Debug failing data imports with customers", "Write troubleshooting guides"]);
    expect(record.preferred).toEqual(["Experience with dbt"]);
    expect(record.pay).toMatchObject({ text: "$140k–$165k/year", min: 140000, max: 165000, period: "year" });
    expect(record.workSetup?.mode).toBe("remote");
    expect(record.workAuthorization).toMatch(/visa sponsorship/);
    expect(record.tools.map((tool) => tool.name)).toEqual(["SQL", "PostgreSQL"]);
    expect(record.missing).toEqual([]);
  });

  it("plain paste: labels with colons, hourly pay, days in the office", () => {
    const record = buildPostingRecord(PLAIN);
    expect(record.title).toBe("Implementation Specialist");
    expect(record.responsibilities).toEqual(["Configure customer accounts during onboarding", "Run training sessions for new admins"]);
    expect(record.requiredItems).toEqual(["At least 2 years of customer onboarding experience", "Comfort with spreadsheets and CSV imports"]);
    expect(record.pay).toMatchObject({ min: 32, max: 38, period: "hour" });
    expect(record.workSetup).toMatchObject({ mode: "hybrid", daysInOffice: 3 });
    expect(record.experience).toBe("2 years");
  });

  it("is deterministic and keyed to the posting text", () => {
    expect(buildPostingRecord(MARKDOWN)).toEqual(buildPostingRecord(MARKDOWN));
    expect(buildPostingRecord(MARKDOWN).sourceHash).not.toBe(buildPostingRecord(PLAIN).sourceHash);
  });
});

describe("posting record: field parsers", () => {
  it("reads pay ranges and skips funding amounts", () => {
    expect(parsePay("We have raised $50M from investors.")).toBeNull();
    expect(parsePay("Compensation: £45,000 to £55,000 per annum")).toMatchObject({ min: 45000, max: 55000, currency: "GBP", period: "year" });
    expect(parsePay("The base salary range is $120,000 - $150,000 USD.")).toMatchObject({ min: 120000, max: 150000, period: "year" });
  });

  it("reads work setup from tags, labels, and sentences", () => {
    expect(parseWorkSetup("#LI-Remote")).toEqual({ mode: "remote", daysInOffice: null, text: "Remote" });
    expect(parseWorkSetup("- **Employment Type**: Full-time / Onsite (5 days/week)")).toMatchObject({ mode: "onsite", daysInOffice: 5 });
    expect(parseWorkSetup("This role is onsite in New York City.")).toMatchObject({ mode: "onsite" });
    expect(parseWorkSetup("- Generous lunch budget for in-office days")).toBeNull();
  });

  it("reads seniority from the title, then years", () => {
    expect(seniorityOf("Software Engineer III", null)).toBe("senior");
    expect(seniorityOf("Customer Success Manager", null)).toBeNull();
    expect(seniorityOf("Support Engineer", "8+ years")).toBe("senior");
    expect(seniorityOf("Staff Solutions Architect", null)).toBe("staff");
  });
});

describe("posting record file", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("is saved once and rebuilt when the posting or the parser version changes", async () => {
    dir = await mkdtemp(join(tmpdir(), "posting-record-"));
    await writeFile(join(dir, "original_jd.md"), MARKDOWN);
    const first = await readPostingRecord(dir);
    const saved = JSON.parse(await readFile(join(dir, POSTING_RECORD_FILE), "utf8"));
    expect(saved).toEqual(first);
    expect(saved.parserVersion).toBe(POSTING_PARSER_VERSION);

    await writeFile(join(dir, POSTING_RECORD_FILE), JSON.stringify({ ...saved, parserVersion: POSTING_PARSER_VERSION + 1 }));
    await writeFile(join(dir, "original_jd.md"), PLAIN);
    const rebuilt = await readPostingRecord(dir);
    expect(rebuilt?.title).toBe("Implementation Specialist");
    expect(JSON.parse(await readFile(join(dir, POSTING_RECORD_FILE), "utf8")).sourceHash).toBe(rebuilt?.sourceHash);
  });

  it("is null for a job without a posting", async () => {
    dir = await mkdtemp(join(tmpdir(), "posting-record-"));
    expect(await readPostingRecord(dir)).toBeNull();
  });
});

describe("pay comes from the pay line, not other money in the posting", () => {
  it("skips the company's revenue and funding and reads the salary", () => {
    const posting = [
      "# Customer Success Manager", "**Company:** Northstar Labs", "**Source:** https://jobs.ashbyhq.com/northstar/1", "",
      "We've raised a $13.5 million Series A.",
      "- Our CEO scaled sales teams from $0 to $30M in ARR.",
      "## Benefits", "- $120K-$150K base salary + early equity", "- Yearly $500 learning stipend",
    ].join("\n");
    expect(parsePay(posting)).toMatchObject({ min: 120000, max: 150000, period: "year" });
  });

  it("keeps a salary sentence that also mentions funding far from the amount", () => {
    const posting = "# Analyst\n\nThe estimated starting annual salary range for this position is $135,000 to $180,000 USD. The range is a guideline and may change with skills, experience, and the company's funding stage.";
    expect(parsePay(posting)).toMatchObject({ min: 135000, max: 180000 });
  });

  it("reports no pay rather than a wrong one when only company money appears", () => {
    expect(parsePay("# Engineer\n\nWe grew from $0 to $30M ARR and raised $50M from top investors.")).toBeNull();
  });
});
