import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandBundleBaselines, recordRunDuration } from "../electron/application-finalize";
import { extractJobDescription, fetchJobDescription, htmlToText, suggestJobId } from "../electron/jd-fetch";
import { stageFetchedJobDescription } from "../electron/evidence-snapshot";
import type { ApplicationBundle, ApplicationContext, EvidenceSnapshot } from "../src/shared/schemas";

const temps: string[] = [];
async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sensei-speed-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const canonical = {
  employers: [
    { name: "Northstar Labs", originalBulletCount: 3, originalBullets: ["Built API integrations.", "Supported onboarding.", "Wrote runbooks."] },
    { name: "Earlier Co", originalBulletCount: 2, originalBullets: ["Built dashboards.", "Maintained ETL jobs."] },
  ],
} as unknown as NonNullable<EvidenceSnapshot["canonicalResume"]>;

const context = {
  schemaVersion: 2,
  resumeTemplate: {
    employers: [
      { name: "Northstar Labs", baselineBullets: [
        { text: "Built API integrations.", evidenceIds: ["context:bank:api"] },
        { text: "Supported onboarding.", evidenceIds: [] },
        { text: "Wrote runbooks.", evidenceIds: [] },
      ] },
      { name: "Earlier Co", baselineBullets: [
        { text: "Built dashboards.", evidenceIds: [] },
        { text: "Maintained ETL jobs.", evidenceIds: [] },
      ] },
    ],
  },
} as unknown as ApplicationContext;

function bundle(employers: ApplicationBundle["resume"]["employers"]): ApplicationBundle {
  return {
    schemaVersion: 1, applicationRunId: "run", evidenceSnapshotId: "snap", canonicalBaselineId: "base", evaluationMarkdown: "# Eval",
    resume: { skillsLines: [{ text: "**Engineering:** APIs", evidenceIds: ["context:a"] }], employers },
    coverLetter: { date: "Today", recipientLines: ["Hiring Manager"], salutation: "Dear Hiring Manager,", bodyParagraphs: [{ sentences: [{ text: "I build things.", evidenceIds: [] }] }], closing: "Sincerely," },
    excludedClaims: [], warnings: [],
  };
}

describe("smaller bundles: baseline references and omitted employers", () => {
  it("expands { baseline: N } and fills omitted employers from the base resume, in base-resume order", () => {
    const expanded = expandBundleBaselines(bundle([
      { name: "Northstar Labs", bullets: [{ text: "Led partner onboarding for enterprise clients.", evidenceIds: ["context:x"] }, { baseline: 1 }, { baseline: 3 }] },
    ]), canonical, context);

    expect(expanded.resume.employers.map((employer) => employer.name)).toEqual(["Northstar Labs", "Earlier Co"]);
    expect(expanded.resume.employers[0]!.bullets).toEqual([
      { text: "Led partner onboarding for enterprise clients.", evidenceIds: ["context:x"] },
      { text: "Built API integrations.", evidenceIds: ["context:bank:api"] },
      { text: "Wrote runbooks.", evidenceIds: [] },
    ]);
    expect(expanded.resume.employers[1]!.bullets.map((bullet) => bullet.text)).toEqual(["Built dashboards.", "Maintained ETL jobs."]);
  });

  it("rejects a reference to a base-resume bullet that doesn't exist", () => {
    expect(() => expandBundleBaselines(bundle([{ name: "Northstar Labs", bullets: [{ baseline: 9 }] }]), canonical, context)).toThrow();
  });
});

describe("jd:fetch", () => {
  const posting = `<html><head><title>Careers</title>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "JobPosting", title: "Solutions Engineer",
      hiringOrganization: { name: "Acme, Inc." },
      jobLocation: { address: { addressLocality: "Portland", addressRegion: "OR", addressCountry: "US" } },
      description: `<p>We help teams ship.</p><h2>What you'll do</h2><ul><li>Guide customers through onboarding &amp; setup.</li><li>${"Partner with engineering on integrations. ".repeat(12)}</li></ul>`,
    })}</script></head><body><div id="app"></div></body></html>`;

  it("prefers embedded JobPosting data and produces readable Markdown", () => {
    const extracted = extractJobDescription(posting, "https://jobs.example.com/1");
    expect(extracted.title).toBe("Solutions Engineer");
    expect(extracted.company).toBe("Acme, Inc.");
    expect(extracted.location).toBe("Portland, OR, US");
    expect(extracted.suggestedJobId).toBe("acme-solutions-engineer");
    expect(extracted.markdown).toContain("# Solutions Engineer");
    expect(extracted.markdown).toContain("- Guide customers through onboarding & setup.");
    expect(extracted.markdown).not.toContain("<li>");
  });

  it("strips scripts and tags from plain pages", () => {
    expect(htmlToText("<script>evil()</script><p>Hello <b>world</b></p>")).toBe("Hello **world**");
    expect(suggestJobId("Northstar Labs LLC", "Data Analyst II")).toBe("northstar-labs-data-analyst-ii");
  });

  it("stages the posting, then the snapshot step creates the job folder from it", async () => {
    const workspace = await temp();
    const fetcher = (async () => new Response(posting, { status: 200 })) as unknown as typeof fetch;
    const fetched = await fetchJobDescription(workspace, "https://jobs.example.com/1", fetcher);
    const startedAt = await stageFetchedJobDescription(workspace, "acme-solutions-engineer");
    expect(startedAt).toBe(fetched.fetchedAt);
    expect(await readFile(join(workspace, "jobs", "acme-solutions-engineer", "original_jd.md"), "utf8")).toContain("# Solutions Engineer");
  });

  it("refuses JavaScript-only pages so the user is asked to paste the JD", async () => {
    const workspace = await temp();
    const fetcher = (async () => new Response("<html><body><div id='root'></div></body></html>", { status: 200 })) as unknown as typeof fetch;
    await expect(fetchJobDescription(workspace, "https://jobs.example.com/2", fetcher)).rejects.toThrow(/paste the JD/);
  });
});

describe("run timing", () => {
  it("records the end-to-end duration at finalize", async () => {
    const workspace = await temp();
    const state = join(workspace, "jobs", "job-1", ".sensei");
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "run_timing.json"), JSON.stringify({ startedAt: "2026-10-24T10:00:00.000Z", snapshotAt: "2026-10-24T10:00:05.000Z" }));
    expect(await recordRunDuration(workspace, "job-1", new Date("2026-10-24T10:00:52.000Z"))).toBe(52);
    expect(JSON.parse(await readFile(join(state, "run_timing.json"), "utf8")).durationSeconds).toBe(52);
  });
});

describe("slim application context", () => {
  it("drops duplicated and unused model-facing fields but keeps what the finalizer needs", async () => {
    const { serializeCompactApplicationContext } = await import("../electron/evidence-snapshot");
    const slim = JSON.parse(serializeCompactApplicationContext({
      schemaVersion: 2,
      candidate: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan", transitionSummary: "", preferredRoleFamilies: [], storyGuidance: ["dup"], voiceGuidance: ["dup"] },
      resumeTemplate: { baselineId: "b", originalSkillsLines: [], editableSkillCategories: [], employers: [
        { name: "Northstar Labs", originalBulletCount: 1, originalBullets: ["Built APIs."], baselineBullets: [{ text: "Built APIs.", evidenceIds: [] }] },
      ] },
      evidenceRows: [{ evidenceId: "context:a", claim: "Built APIs.", scope: "", employer: "Northstar Labs", project: "API", sourcePath: "context/structured/work.md", sourceFamily: null, timeline: "current", eligibility: "eligible", maximumClassification: "direct", sourceAuthority: "primary" }],
    } as never));
    expect(slim.candidate.storyGuidance).toBeUndefined();
    expect(slim.resumeTemplate.employers[0].originalBullets).toBeUndefined();
    expect(slim.resumeTemplate.employers[0].baselineBullets).toHaveLength(1);
    expect(slim.evidenceRows[0].sourcePath).toBeUndefined();
    expect(slim.evidenceRows[0].evidenceId).toBe("context:a");
  });
});
