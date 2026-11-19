// #114: the user's corrections to a job's details win everywhere and survive re-reads of the posting. Fictional jobs only.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listJobFolders } from "../electron/job-folders";
import { recordJobCompany } from "../electron/job-company";
import { readJobOverrides, saveJobOverrides, withIdentityOverrides } from "../electron/job-overrides";
import { applyJobOverrides, jobOverridesSchema, overriddenFields, payLine } from "../src/shared/job-overrides";
import { jobFolderSummarySchema, roleFactsSchema } from "../src/shared/schemas";

const made: string[] = [];
afterEach(async () => { await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function workspace(): Promise<{ root: string; job: string }> {
  const root = await mkdtemp(join(tmpdir(), "sensei-overrides-"));
  made.push(root);
  const job = join(root, "jobs", "northwind-support");
  await mkdir(join(job, ".sensei"), { recursive: true });
  await writeFile(join(job, ".sensei", "job.json"), JSON.stringify({ id: "northwind-support", company: "Northwnd Careers", title: "Support Engineer", location: "Remote" }));
  await writeFile(join(job, "original_jd.md"), "# Support Engineer\n\nCompany: Northwnd Careers\n\n## Requirements\n- Help customers with integrations\n");
  return { root, job };
}

describe("the corrections file (#114)", () => {
  it("treats blank fields and empty pay as not corrected", () => {
    const overrides = jobOverridesSchema.parse({ company: "  ", title: "Support Lead", pay: { min: null, max: null } });
    expect(overrides.company).toBeNull();
    expect(overrides.pay).toBeNull();
    expect(overriddenFields(overrides)).toEqual(["title"]);
  });

  it("writes pay as one line", () => {
    expect(payLine({ min: 120000, max: 150000, currency: "USD", period: "year" })).toBe("$120,000–$150,000 a year");
    expect(payLine({ min: 40, max: null, currency: "EUR", period: "hour" })).toBe("€40 an hour");
    expect(payLine({ min: 90000, max: 90000, currency: "CHF", period: "year" })).toBe("90,000 CHF a year");
  });

  it("lays corrections over the job as shown", () => {
    const summary = jobFolderSummarySchema.parse({
      id: "a", relativePath: "jobs/a", name: "a", company: "Wrong Co", title: "Engineer", createdAt: "2026-11-01T00:00:00.000Z", modifiedAt: "2026-11-01T00:00:00.000Z", artifactCount: 1,
      role: roleFactsSchema.parse({ workMode: "onsite", workArrangement: "On-site", missing: ["pay"] }),
    });
    const shown = applyJobOverrides(summary, jobOverridesSchema.parse({ company: "Right Co", workMode: "remote", pay: { min: 100000, max: 120000 } }));
    expect(shown.company).toBe("Right Co");
    expect(shown.title).toBe("Engineer");
    expect(shown.role?.workMode).toBe("remote");
    expect(shown.role?.pay).toBe("$100,000–$120,000 a year");
    expect(shown.role?.missing).toEqual([]);
    expect(shown.editedFields).toEqual(["company", "workMode", "pay"]);
  });
});

describe("corrections in the app (#114)", () => {
  it("show in the job list right away and survive a rebuilt posting record", async () => {
    const { root, job } = await workspace();
    expect((await listJobFolders(root))[0]!.company).not.toBe("Northwind");
    await saveJobOverrides(root, "northwind-support", { company: "Northwind", pay: { min: 95000, max: 110000, currency: "USD", period: "year" } });
    let shown = (await listJobFolders(root))[0]!;
    expect(shown.company).toBe("Northwind");
    expect(shown.editedFields).toEqual(["company", "pay"]);
    // A re-read of the posting (here: the record deleted and rebuilt) never touches the corrections.
    await rm(join(job, ".sensei", "posting.json"), { force: true });
    await writeFile(join(job, "original_jd.md"), "# Support Engineer\n\nCompany: Northwnd Careers\n\n## Requirements\n- Help customers with integrations\n- Write runbooks\n");
    shown = (await listJobFolders(root))[0]!;
    expect(shown.company).toBe("Northwind");
    expect((await readJobOverrides(job)).pay?.min).toBe(95000);
  });

  it("name drafts: the identity and the resume's company use the correction", async () => {
    const { root, job } = await workspace();
    await saveJobOverrides(root, "northwind-support", { company: "Northwind", title: "Senior Support Engineer" });
    expect(await withIdentityOverrides(job, { company: "Northwnd Careers", title: "Support Engineer", location: "Remote" }))
      .toEqual({ company: "Northwind", title: "Senior Support Engineer", location: "Remote" });
    // A run passing --company still gets the user's company for the file name.
    expect(await recordJobCompany(root, "northwind-support", "Northwnd")).toBe("Northwind");
  });

  it("rejects a bad job ID", async () => {
    const { root } = await workspace();
    await expect(saveJobOverrides(root, "../escape", { company: "X" })).rejects.toThrow(/invalid/);
  });
});
