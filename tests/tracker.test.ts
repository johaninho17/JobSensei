import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateJobTracker } from "../electron/tracker";
import { listJobFolders } from "../electron/job-folders";
import { effectiveAppliedAt, effectiveStatus, followUpDays } from "../src/shared/tracker";

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
    const same = await updateJobTracker(root, "northstar-analyst", { status: "applied", notes: "Referral from Sam" }, now);
    expect(same.history).toHaveLength(1);
    const interviewing = await updateJobTracker(root, "northstar-analyst", { status: "interviewing", nextFollowUpAt: "2026-10-30" }, now);
    expect(interviewing).toMatchObject({ appliedAt: "2026-10-25", notes: "Referral from Sam", nextFollowUpAt: "2026-10-30" });
    expect(interviewing.history.map((event) => event.status)).toEqual(["applied", "interviewing"]);
    const saved = JSON.parse(await readFile(join(root, "jobs", "northstar-analyst", ".sensei", "tracker.json"), "utf8"));
    expect(saved.status).toBe("interviewing");
    const [job] = await listJobFolders(root);
    expect(job?.tracker?.status).toBe("interviewing");
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
    const base = { tracker: null, hasApplicationMaterials: false, interviewRoundLabel: null, createdAt: "2026-10-20T09:00:00Z" };
    expect(effectiveStatus(base)).toBe("saved");
    expect(effectiveAppliedAt(base)).toBeNull();
    expect(effectiveStatus({ ...base, hasApplicationMaterials: true })).toBe("applied");
    expect(effectiveAppliedAt({ ...base, hasApplicationMaterials: true })).toBe("2026-10-20");
    expect(effectiveStatus({ ...base, hasApplicationMaterials: true, interviewRoundLabel: "Recruiter screen" })).toBe("interviewing");
    expect(effectiveStatus({ ...base, hasApplicationMaterials: true, tracker: { status: "rejected", appliedAt: null } })).toBe("rejected");
    expect(followUpDays({ nextFollowUpAt: "2026-10-24" }, new Date(2026, 9, 25))).toBe(-1);
    expect(followUpDays({ nextFollowUpAt: "2026-10-27" }, new Date(2026, 9, 25))).toBe(2);
    expect(followUpDays(null)).toBeNull();
  });
});
