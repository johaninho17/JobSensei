// Issue #174: a cut-off page never leaves script code as the posting; amazon.jobs reads from its search JSON; bullets
// without a space and "Label: value" lines read correctly. Fictional postings only.
import { describe, expect, it } from "vitest";
import { amazonCompany, fetchAndClean, htmlToText } from "../electron/jd-fetch";
import { buildPostingRecord } from "../electron/posting-record";

describe("pages that come out as script", () => {
  it("drops a script the response cut off before it closed", () => {
    const text = htmlToText("<html><head><script>window.Telemetry = { sampleRate: 1, endpoint: \"https://telemetry.example.com\",");
    expect(text).not.toMatch(/Telemetry|sampleRate/);
  });
  it("reads bullets written with no space after the dot", () => {
    expect(htmlToText("<p>Duties:<br/>•Check the loading dock<br/>• Log each shipment</p>")).toBe("Duties:\n- Check the loading dock\n- Log each shipment");
  });
  it("keeps the overview after Label: value lines", () => {
    const record = buildPostingRecord("# Dock Coordinator\n\n**Company:** Northwind\n**Source:** https://jobs.example.com/1\n\n## Description\n\nShift: Nights\nDepartment: 4400 - Receiving\n\nHere at Northwind we are hiring a dock coordinator to keep inbound freight moving safely every night.\n\n## Basic Qualifications\n- High school or equivalent\n");
    expect(record.summary[0]).toMatch(/^Here at Northwind/);
  });
});

describe("amazon.jobs", () => {
  const job = { id_icims: "4242", title: "Dock Coordinator", company_name: "Amazon.com Services LLC", normalized_location: "Springfield, Ohio, USA", posted_date: "October 2, 2026", job_schedule_type: "full-time", description: "Here at the site we are hiring a dock coordinator to keep freight moving.<br/><br/>Responsibilities:<br/>•Check the dock<br/>•Log shipments", basic_qualifications: "- High school or equivalent<br/>- Can lift 40 pounds", preferred_qualifications: "- 1+ years in logistics" };
  const fetcher: typeof fetch = async (input) => String(input).includes("search.json?job_id_icims%5B%5D=4242")
    ? new Response(JSON.stringify({ jobs: [job] }), { status: 200, headers: { "Content-Type": "application/json" } })
    : new Response("not found", { status: 404 });

  it("reads the posting's own fields from the search JSON", async () => {
    const { extracted } = await fetchAndClean("https://www.amazon.jobs/en/jobs/4242/dock-coordinator", fetcher, { render: false });
    const record = buildPostingRecord(extracted.markdown);
    expect(record).toMatchObject({ title: "Dock Coordinator", company: "Amazon", postedAt: "2026-10-02", jobId: "4242" });
    expect(record.location).toBe("Springfield, OH"); // one location form: normalLocation (src/shared/posting-fields.ts)
    expect(record.responsibilities).toEqual(["Check the dock", "Log shipments"]);
    expect(record.requiredItems).toContain("High school or equivalent");
    expect(record.preferred).toEqual(["1+ years in logistics"]);
  });
  it("names Amazon's own entities Amazon and keeps other entities", () => {
    expect(amazonCompany("Amazon.com Services LLC")).toBe("Amazon");
    expect(amazonCompany("Amazon Web Services, Inc.")).toBe("Amazon Web Services, Inc.");
    expect(amazonCompany(null)).toBe("Amazon");
  });
});
