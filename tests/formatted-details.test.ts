import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { payLine } from "../src/shared/job-overrides";
import { formatPay } from "../src/shared/pay";

describe("formatted job details (#209)", () => {
  it("has one pay formatter", () => {
    expect(payLine({ min: 120000, max: 150000, currency: "USD", period: "year" })).toBe(formatPay(120000, 150000, "USD", "year"));
    expect(formatPay(90000, 90000, "CHF", "year")).toBe("90,000 CHF a year");
    expect(formatPay(40, null, "EUR", "hour")).toBe("€40 an hour");
  });

  it("Edit details shows pay formatted and currency as a choice", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const form = page.slice(page.indexOf("function EditJobDetails"), page.indexOf("function FramingLines"));
    expect(form).toContain("value={money(form.min)}");
    expect(form).toContain('<label><span>Currency</span><select');
  });
});

describe("Job Search facts in one style (#210)", () => {
  it("formats pay text from boards and pages the same way", async () => {
    const { normalPayText } = await import("../src/shared/pay");
    expect(normalPayText("$120,000–$240,000/year")).toBe("$120,000 – $240,000 a year");
    expect(normalPayText("$240K–$300K/year")).toBe("$240,000 – $300,000 a year");
    expect(normalPayText("$25–$50/hour")).toBe("$25 – $50 an hour");
    expect(normalPayText("Competitive")).toBe("Competitive");
  });

  it("reads a work setup phrase as one label", async () => {
    const { locationLine, normalLocation, workModeOf } = await import("../src/shared/posting-fields");
    expect(workModeOf("Our team works fully in-person in our San Francisco office")).toBe("onsite");
    expect(workModeOf("Work setup: Remote")).toBe("remote");
    expect(locationLine(normalLocation("Remote - United States"), workModeOf("Remote - United States"))).toBe("Remote (US)");
    expect(locationLine(normalLocation("San Francisco, California, US"), "onsite")).toBe("San Francisco, CA · On-site");
  });
});
