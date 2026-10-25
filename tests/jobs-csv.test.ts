import { describe, expect, it } from "vitest";
import { csvCell, jobsToCsv } from "../src/shared/jobs-csv";
import type { JobFolderSummary } from "../src/shared/schemas";

const job = (patch: Partial<JobFolderSummary>): JobFolderSummary => ({ id: "northstar-analyst", relativePath: "jobs/northstar-analyst", name: "northstar-analyst", title: "Support Analyst", company: "Northstar Labs", createdAt: "2026-10-20T12:00:00", modifiedAt: "2026-10-20T12:00:00", artifactCount: 3, applicationStage: null, rating: 4.13, ratingDecision: null, ratingConfidence: null, ratingHighlights: [], ratingGaps: [], location: "Remote, US", interviewRoundLabel: null, hasApplicationMaterials: true, tracker: null, ...patch });

describe("jobs CSV export", () => {
  it("quotes, escapes, and guards formulas", () => {
    expect(csvCell('Said "hi", then left')).toBe('"Said ""hi"", then left"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(null)).toBe("");
  });

  it("writes a BOM, the header, and one row per job with derived status", () => {
    const csv = jobsToCsv([job({}), job({ id: "meridian-se", company: "Meridian, Inc.", tracker: { schemaVersion: 1, status: "rejected", appliedAt: "2026-10-01", nextFollowUpAt: null, notes: "Line one\nline two", history: [], updatedAt: null } })]);
    expect(csv.startsWith("﻿Company,Title,Status,Applied,Follow up,Fit,Interview,Location,Added,Notes,Job ID\r\n")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe('Northstar Labs,Support Analyst,Applied,2026-10-20,,4.1,,"Remote, US",2026-10-20,,northstar-analyst');
    expect(lines[2]).toContain('"Meridian, Inc."');
    expect(lines[2]).toContain('Rejected,2026-10-01');
    expect(lines[2]).toContain('"Line one\nline two"');
  });
});
