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
