// #211: Archived replaces Closed; the Jobs count shows live applications only.
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateJobTracker } from "../electron/tracker";
import { isArchived, liveApplicationCount } from "../src/shared/tracker";

const job = (status: string | null, archivedAt: string | null = null) => ({
  hasApplicationMaterials: true, hasPdfs: false, interviewRoundLabel: null,
  tracker: status ? { status, appliedAt: null, archivedAt } : null,
}) as never;

describe("archived jobs (#211)", () => {
  it("counts rejected, withdrawn, and user-archived jobs as archived, and counts only live applications", () => {
    expect(isArchived(job("rejected"))).toBe(true);
    expect(isArchived(job("withdrawn"))).toBe(true);
    expect(isArchived(job("saved", "2026-11-26"))).toBe(true);
    expect(isArchived(job("applied"))).toBe(false);
    expect(liveApplicationCount([job("applied"), job("interviewing"), job("offer"), job("saved"), job(null), job("rejected"), job("applied", "2026-11-26")])).toBe(3);
  });

  it("keeps the status when a job is archived and unarchived", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-archive-"));
    await mkdir(join(root, "jobs", "northstar-analyst"), { recursive: true });
    await updateJobTracker(root, "northstar-analyst", { status: "applied" });
    expect(await updateJobTracker(root, "northstar-analyst", { archivedAt: "2026-11-26" })).toMatchObject({ status: "applied", archivedAt: "2026-11-26" });
    expect(await updateJobTracker(root, "northstar-analyst", { archivedAt: null })).toMatchObject({ status: "applied", archivedAt: null });
  });
});
