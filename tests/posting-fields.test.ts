// One normal form for posting fields (#53): real-world shapes of each value, written with fictional names.
import { describe, expect, it } from "vitest";
import { buildPostingRecord } from "../electron/posting-record";
import { companyKey, locationLine, normalCompany, normalEmploymentType, normalLocation, normalPostedDate, normalTitle, workSetupInLocation } from "../src/shared/posting-fields";

describe("posting fields", () => {
  it.each([
    ["Northstar Labs, Inc.", "Northstar Labs"],
    ["Northstar Labs LLC", "Northstar Labs"],
    ["120 Northstar Mexico S. de R.L. de C.V.", "Northstar Mexico"],
    ["NSL Candidate Experience page", "NSL"],
    ["Northstar Careers", "Northstar"],
    ["Northstar GmbH", "Northstar"],
    ["", null],
  ])("company %s", (value, expected) => expect(normalCompany(value)).toBe(expected));

  it("matches a company however it is written", () => {
    expect(companyKey("Northstar Labs, Inc.")).toBe(companyKey("northstar labs"));
  });

  it.each([
    ["Support Engineer | Northstar Careers", "Northstar", "Support Engineer"],
    ["Support Engineer - Northstar", "Northstar", "Support Engineer"],
    ["Job Application for Support Engineer", null, "Support Engineer"],
    ["Support Engineer - Billing", "Northstar", "Support Engineer - Billing"],
    ["Platform & Security Sales Specialist", "Northstar", "Platform & Security Sales Specialist"],
  ])("title %s", (value, company, expected) => expect(normalTitle(value, company)).toBe(expected));

  it.each([
    ["Philadelphia, PA, United States", "Philadelphia, PA"],
    ["Philadelphia, PA, USA", "Philadelphia, PA"],
    ["Mexico - Mexico City", "Mexico City, Mexico"],
    ["Remote - US", "Remote (US)"],
    ["Remote", "Remote"],
    ["London, United Kingdom", "London, United Kingdom"],
    ["San Francisco, CA (Remote / Telecommute - United States)", "San Francisco, CA"],
    ["Austin, TX (Hybrid)", "Austin, TX"],
    ["New York, NY (Midtown)", "New York, NY (Midtown)"],
    ["San Francisco, California, US", "San Francisco, CA"],
    ["San Francisco Office", "San Francisco"],
  ])("location %s", (value, expected) => expect(normalLocation(value)).toBe(expected));

  it.each([
    ["Full time", "Full-time"],
    ["FULL_TIME", "Full-time"],
    ["Part-time", "Part-time"],
    ["Contract (6 months)", "Contract"],
    ["Summer Internship", "Internship"],
    ["Hybrid", null],
  ])("employment type %s", (value, expected) => expect(normalEmploymentType(value)).toBe(expected));

  it.each([
    ["2026-11-13", "2026-11-13"],
    ["Posted: Nov 13, 2026", "2026-11-13"],
    ["Posted Yesterday", null],
  ])("posted %s", (value, expected) => expect(normalPostedDate(value)).toBe(expected));

  it("fills the record's normal values from any source", () => {
    const record = buildPostingRecord([
      "# Support Engineer | Northstar Careers",
      "",
      "**Company:** Northstar Labs, Inc.  ",
      "**Location:** Denver, CO, United States  ",
      "**Source:** https://jobs.northstar.example/1",
      "",
      "Employment type: Full time",
      "Posted: 2026-11-10",
      "Job ID: R-2048",
      "",
      "## Requirements",
      "- 2+ years supporting customers of a software product",
    ].join("\n"));
    expect(record).toMatchObject({ title: "Support Engineer", company: "Northstar Labs", location: "Denver, CO", employmentType: "Full-time", postedAt: "2026-11-10", jobId: "R-2048" });
  });
  it("reads the work setup from a location note and shows place and setup on one line (#209)", () => {
    expect(workSetupInLocation("San Francisco, CA (Remote / Telecommute - United States)")).toBe("remote");
    expect(workSetupInLocation("Austin, TX (Hybrid)")).toBe("hybrid");
    expect(workSetupInLocation("Austin, TX")).toBeNull();
    expect(locationLine("San Francisco, CA", "remote")).toBe("San Francisco, CA · Remote");
    expect(locationLine("Remote (US)", "remote")).toBe("Remote (US)");
    expect(locationLine(null, "onsite")).toBe("On-site");
  });
});
