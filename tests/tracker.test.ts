import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateJobTracker } from "../electron/tracker";
import { listJobFolders } from "../electron/job-folders";
import { effectiveAppliedAt, effectiveStatus, readyToSend, staleApplications, statusLabel } from "../src/shared/tracker";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sensei-tracker-"));
  await mkdir(join(root, "jobs", "northstar-analyst"), { recursive: true });
  await writeFile(join(root, "jobs", "northstar-analyst", "original_jd.md"), "# Support Analyst\n\nCompany: Northstar Labs\n");
  return root;
}

describe("job tracker", () => {
  it("records status changes in history and fills the applied date once", async () => {
    const root = await workspace();
    const now = new Date("2026-10-25T15:00:00Z");
    const applied = await updateJobTracker(root, "northstar-analyst", { status: "applied" }, now);
    expect(applied).toMatchObject({ status: "applied", appliedAt: "2026-10-25", history: [{ status: "applied" }] });
    // No follow-up date: follow-ups were removed (U91 follow-on, #194).
    expect(applied).not.toHaveProperty("nextFollowUpAt");
    const same = await updateJobTracker(root, "northstar-analyst", { status: "applied", notes: "Referral from Sam" }, now);
    expect(same.history).toHaveLength(1);
    const interviewing = await updateJobTracker(root, "northstar-analyst", { status: "interviewing" }, now);
    expect(interviewing).toMatchObject({ appliedAt: "2026-10-25", notes: "Referral from Sam" });
    expect(interviewing.history.map((event) => event.status)).toEqual(["applied", "interviewing"]);
    const saved = JSON.parse(await readFile(join(root, "jobs", "northstar-analyst", ".sensei", "tracker.json"), "utf8"));
    expect(saved.status).toBe("interviewing");
    const [job] = await listJobFolders(root);
    expect(job?.tracker?.status).toBe("interviewing");
  });

  it("drops a follow-up date left in an old tracker file the next time the job changes", async () => {
    const root = await workspace();
    const file = join(root, "jobs", "northstar-analyst", ".sensei", "tracker.json");
    await mkdir(join(root, "jobs", "northstar-analyst", ".sensei"), { recursive: true });
    await writeFile(file, JSON.stringify({ schemaVersion: 1, status: "applied", appliedAt: "2026-10-01", nextFollowUpAt: "2026-10-08" }));
    const [job] = await listJobFolders(root);
    expect(job?.tracker).not.toHaveProperty("nextFollowUpAt");
    await updateJobTracker(root, "northstar-analyst", { notes: "Heard back" }, new Date("2026-10-25T15:00:00Z"));
    expect(JSON.parse(await readFile(file, "utf8"))).not.toHaveProperty("nextFollowUpAt");
  });

  it("rejects bad input and unknown jobs", async () => {
    const root = await workspace();
    await expect(updateJobTracker(root, "northstar-analyst", { status: "hired" })).rejects.toThrow();
    await expect(updateJobTracker(root, "northstar-analyst", { appliedAt: "10/25/2026" })).rejects.toThrow();
    await expect(updateJobTracker(root, "northstar-analyst", { extra: true })).rejects.toThrow();
    await expect(updateJobTracker(root, "../outside", { status: "applied" })).rejects.toThrow(/invalid/);
    await expect(updateJobTracker(root, "missing-job", { status: "applied" })).rejects.toThrow(/No job folder/);
  });

  it("derives status from the pipeline until the user sets one", () => {
    const base = { tracker: null, hasApplicationMaterials: false, interviewRoundLabel: null, createdAt: "2026-10-20T12:00:00" };
    expect(effectiveStatus(base)).toBe("saved");
    expect(effectiveAppliedAt(base)).toBeNull();
    // Drafting is not applying: drafts alone stay saved and read "Drafted"; PDFs are what mark the job applied.
    const drafted = { ...base, hasApplicationMaterials: true };
    expect(effectiveStatus(drafted)).toBe("saved");
    expect(readyToSend(drafted)).toBe(true);
    expect(statusLabel(drafted)).toBe("Drafted");
    expect(effectiveAppliedAt(drafted)).toBeNull();
    const withPdfs = { ...drafted, hasPdfs: true, pdfsAt: "2026-10-23T09:30:00" };
    expect(effectiveStatus(withPdfs)).toBe("applied");
    expect(statusLabel(withPdfs)).toBe("Applied");
    expect(effectiveAppliedAt(withPdfs)).toBe("2026-10-23");
    expect(effectiveAppliedAt({ ...withPdfs, pdfsAt: null })).toBe("2026-10-20");
    // The user's choice wins both ways: Undo after PDFs returns to Drafted; a set status ignores PDFs.
    expect(statusLabel({ ...withPdfs, tracker: { status: "saved", appliedAt: null } })).toBe("Drafted");
    expect(statusLabel({ ...drafted, tracker: { status: "applied", appliedAt: "2026-10-21" } })).toBe("Applied");
    expect(statusLabel(base)).toBe("Saved");
    expect(effectiveStatus({ ...base, hasApplicationMaterials: true, interviewRoundLabel: "Recruiter screen" })).toBe("interviewing");
    expect(effectiveStatus({ ...base, hasApplicationMaterials: true, tracker: { status: "rejected", appliedAt: null } })).toBe("rejected");
  });

  it("finds applications with no reply after 30 days", () => {
    const now = Date.parse("2026-10-25T12:00:00");
    const job = (id: string, createdAt: string, tracker: Parameters<typeof staleApplications>[0][number]["tracker"] = null) => ({ id, tracker, hasApplicationMaterials: true, hasPdfs: true, interviewRoundLabel: null, createdAt });
    const jobs = [job("old", "2026-09-01T10:00:00"), job("new", "2026-10-20T10:00:00"), job("touched", "2026-09-01T10:00:00", { status: "applied", appliedAt: "2026-09-01", updatedAt: "2026-10-20T10:00:00Z" } as never), job("closed", "2026-09-01T10:00:00", { status: "rejected", appliedAt: null } as never)];
    expect(staleApplications(jobs, now).map((entry) => entry.id)).toEqual(["old"]);
  });
});

describe("closed jobs that reached interviews", () => {
  it("counts prepared rounds, a current round, or a tracker that was ever Interviewing or Offer", async () => {
    const { reachedInterview } = await import("../src/shared/tracker");
    const base = { interviewRoundLabel: null, interviewRoundCount: 0, tracker: { status: "rejected" as const, history: [{ status: "applied" as const }, { status: "rejected" as const }] } };
    expect(reachedInterview(base)).toBe(false);
    expect(reachedInterview({ ...base, interviewRoundCount: 1 })).toBe(true);
    expect(reachedInterview({ ...base, interviewRoundLabel: "Recruiter screen" })).toBe(true);
    expect(reachedInterview({ ...base, tracker: { status: "rejected", history: [{ status: "interviewing" }, { status: "rejected" }] } })).toBe(true);
    expect(reachedInterview({ ...base, tracker: null })).toBe(false);
  });
});
