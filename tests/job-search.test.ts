import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_SEARCH_SETTINGS, autoDraftPicks, canonicalUrl, effectiveFit, jobKey, lightRatingPicks, locationFits, placesFor, rankInbox, skippedSite, titleExcluded,
  type InboxItem, type JobSearchState,
} from "../src/shared/job-search";
import {
  boardOf, buildRatingPrompt, buildSearchPrompt, parseRatingReply, closedPosting, nameJob, resolveLink, singlePosting, parseSearchReply, postingAgeDays, quickFit, readSearchState, runSearch,
  markSavedJobQueued, readSearchSettings, saveFoundJob, saveSearchSettings, stageFoundJob, vocabularyFrom,
} from "../electron/job-search";
import { buildPostingRecord } from "../electron/posting-record";
import { boardRef, fitsSearchTitles, titleSimilarity } from "../electron/job-boards";

const POSTING = `# Solutions Engineer

**Company:** Northstar Labs
**Location:** Remote, United States
**Source:** https://jobs.lever.co/northstar/abc

Northstar Labs builds data tools for retail teams. You will help customers launch and get value from the product.

## Requirements
- 3+ years in a customer-facing technical role such as solutions engineering or onboarding
- Strong SQL and Python skills for data troubleshooting
- Experience with Salesforce and Kotlin
- Clear written and spoken communication with technical and business audiences

## Responsibilities
- Run technical discovery with new customers and scope their onboarding
- Troubleshoot integrations and work with engineering to resolve issues

Pay: $120,000 - $150,000 per year. This role is remote.
`;

const settings = { ...DEFAULT_JOB_SEARCH_SETTINGS, titles: ["Solutions Engineer"] };

function item(id: string, score: number, patch: Partial<InboxItem> = {}): InboxItem {
  return {
    id, url: `https://jobs.lever.co/x/${id}`, title: "Solutions Engineer", company: id, location: null, board: "lever", postedAt: null,
    foundAt: "2026-11-05T10:00:00.000Z", runId: "run-1", status: "new", pay: null, workSetup: null, level: null,
    fit: { score, why: "", covered: 0, total: 0, gaps: [], blockers: [], flags: [] }, jobId: null, queuedAt: null, autoQueued: false, watched: false, agyFit: null, ...patch,
  };
}

describe("job search links", () => {
  it("skips boards that block reading and the user's own skip list", () => {
    expect(skippedSite("https://www.linkedin.com/jobs/view/1", settings)).toBe("LinkedIn");
    expect(skippedSite("https://jobs.lever.co/acme/1", settings)).toBeNull();
    expect(skippedSite("https://jobs.lever.co/acme/1", { ...settings, boardsOff: ["lever"] })).toBe("Lever");
    expect(skippedSite("https://careers.example.com/1", { ...settings, skipSites: ["example.com"] })).toBe("example.com");
  });

  it("treats the same posting with tracking parameters as one link", () => {
    expect(canonicalUrl("https://www.boards.greenhouse.io/acme/jobs/1?gh_src=abc&utm_source=x#apply")).toBe("https://boards.greenhouse.io/acme/jobs/1");
  });

  it("reads Agy's reply and drops entries without a real link", () => {
    const links = parseSearchReply('```json\n{"jobs":[{"url":"https://jobs.ashbyhq.com/acme/1","title":"SE","company":"Acme"},{"url":"not a link"},{"title":"no url"}]}\n```');
    expect(links).toEqual([{ url: "https://jobs.ashbyhq.com/acme/1", title: "SE", company: "Acme", location: undefined, postedDate: undefined }]);
  });

  it("finds closed postings and their age", () => {
    expect(closedPosting("Sorry, this job is no longer accepting applications.")).toBe(true);
    expect(closedPosting(POSTING)).toBe(false);
    expect(postingAgeDays("2026-10-01", new Date("2026-11-05T00:00:00Z"))).toBe(35);
    expect(postingAgeDays("yesterday", new Date())).toBeNull();
  });

  it("resolves search-result redirects to the posting's own address", async () => {
    const fetcher = (async (url: string | URL) => String(url).includes("vertexaisearch")
      ? new Response(null, { status: 302, headers: { location: "https://job-boards.greenhouse.io/acme/jobs/7?gh_src=x" } })
      : new Response("", { status: 200 })) as typeof fetch;
    expect(await resolveLink("https://vertexaisearch.cloud.google.com/grounding-api-redirect/AB12", fetcher)).toBe("https://job-boards.greenhouse.io/acme/jobs/7?gh_src=x");
    expect(await resolveLink("https://jobs.lever.co/acme/1", fetcher)).toBe("https://jobs.lever.co/acme/1");
    expect(boardOf("https://job-boards.greenhouse.io/acme/jobs/7")).toBe("greenhouse");
    expect(singlePosting("https://jobs.lever.co/acme?team=Sales")).toBe(false);
    expect(singlePosting("https://jobs.lever.co/acme/")).toBe(false);
    expect(singlePosting("https://jobs.lever.co/acme/1f2e3d")).toBe(true);
    expect(singlePosting("https://job-boards.greenhouse.io/acme/jobs/7")).toBe(true);
    expect(singlePosting("https://job-boards.greenhouse.io/acme")).toBe(false);
  });

  it("splits Lever-style page titles into company and title", () => {
    expect(nameJob({ url: "x" }, null, "Northstar Labs - Solutions Engineer")).toEqual({ company: "Northstar Labs", title: "Solutions Engineer" });
    expect(nameJob({ url: "x", title: "Solutions Engineer", company: "Northstar Labs" }, null, "Careers | Northstar")).toEqual({ company: "Northstar Labs", title: "Solutions Engineer" });
  });

  it("gives Agy the search settings only, with the skipped boards", () => {
    const prompt = buildSearchPrompt({ ...settings, needsSponsorship: true }, ["Acme — SE"], new Date("2026-11-05T00:00:00Z"));
    expect(prompt).toContain("Solutions Engineer");
    expect(prompt).toContain("linkedin.com");
    expect(prompt).toContain("sponsorship");
    expect(prompt).toContain("do not read or write any files");
  });
});

describe("quick fit", () => {
  const record = buildPostingRecord(POSTING);
  const vocab = vocabularyFrom(["Customer Solutions Engineer: technical discovery and onboarding for customers", "Skills: SQL, Python, Looker", "Troubleshoot integrations with engineering"]);

  it("scores coverage from the candidate's own words and lists missing tools", () => {
    const fit = quickFit(record, vocab, settings);
    expect(fit.total).toBeGreaterThan(0);
    expect(fit.gaps).toEqual(expect.arrayContaining(["Salesforce", "Kotlin"]));
    expect(fit.score).toBeGreaterThan(1);
    expect(fit.score).toBeLessThanOrEqual(5);
    expect(fit.why).toMatch(/cover \d+ of \d+/);
    const own = quickFit(buildPostingRecord(POSTING.replace("Experience with Salesforce and Kotlin", "Experience with Northstar and SE tooling")), vocab, settings);
    expect(own.gaps).not.toContain("Northstar");
  });

  it("lowers the score for pay under the floor and caps it on a blocker", () => {
    const base = quickFit(record, vocab, settings).score;
    expect(quickFit(record, vocab, { ...settings, payFloor: 200_000 }).score).toBeLessThan(base);
    const clearance = buildPostingRecord(POSTING.replace("## Responsibilities", "- Active security clearance required\n\n## Responsibilities"));
    const fit = quickFit(clearance, vocab, settings);
    expect(fit.blockers).toContain("Security clearance required");
    expect(fit.score).toBeLessThanOrEqual(1.5);
  });
});

describe("inbox", () => {
  it("ranks by fit and auto-drafts only at or above the rating, within the daily cap", () => {
    const state: JobSearchState = { schemaVersion: 1, runs: [], seen: [], items: [item("a", 3.2), item("b", 4.6), item("c", 4.1), item("d", 4.8, { fit: { score: 4.8, why: "", covered: 0, total: 0, gaps: [], blockers: ["No visa sponsorship"], flags: [] } })] };
    expect(rankInbox(state.items).map((entry) => entry.id)).toEqual(["d", "b", "c", "a"]);
    expect(autoDraftPicks(state, settings)).toEqual([]);
    const picks = autoDraftPicks(state, { ...settings, autoDraftAt: 4, autoDraftDailyCap: 1 }, new Date("2026-11-05T12:00:00Z"));
    expect(picks.map((entry) => entry.id)).toEqual(["b"]);
    const used = { ...state, items: [...state.items, item("e", 4.9, { status: "queued", autoQueued: true, queuedAt: "2026-11-05T09:00:00.000Z" })] };
    expect(autoDraftPicks(used, { ...settings, autoDraftAt: 4, autoDraftDailyCap: 1 }, new Date("2026-11-05T12:00:00Z"))).toEqual([]);
  });
});

describe("search run", () => {
  it("keeps only live, new, readable postings and saves them", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, settings);
    const pages: Record<string, { status: number; body: string }> = {
      "https://jobs.lever.co/northstar/abc": { status: 200, body: `<html><head><title>Northstar Labs - Solutions Engineer</title></head><body><main>${POSTING.replace(/\n/g, "<br>")}</main></body></html>` },
      "https://jobs.lever.co/northstar/closed": { status: 200, body: `<html><body><main>This job is no longer accepting applications. ${"Filler text about the company. ".repeat(30)}</main></body></html>` },
      "https://jobs.lever.co/northstar/gone": { status: 404, body: "Not found" },
    };
    const fetcher = (async (url: string | URL) => {
      const page = pages[String(url)] ?? { status: 404, body: "" };
      return new Response(page.body, { status: page.status, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const reply = JSON.stringify({ jobs: [
      { url: "https://jobs.lever.co/northstar/abc?utm_source=x", title: "Solutions Engineer", company: "Northstar Labs", postedDate: "2026-11-03" },
      { url: "https://jobs.lever.co/northstar/abc", title: "Solutions Engineer", company: "Northstar Labs" },
      { url: "https://jobs.lever.co/northstar/closed" },
      { url: "https://jobs.lever.co/northstar/gone" },
      { url: "https://www.linkedin.com/jobs/view/1" },
      { url: "https://jobs.lever.co/northstar/old", postedDate: "2026-08-01" },
    ] });
    const { run, state } = await runSearch({
      workspace, profile: null, fetcher, existingKeys: new Set(), now: () => new Date("2026-11-05T12:00:00Z"),
      runner: async () => ({ response: reply, conversationId: null }),
    });
    expect(run.status).toBe("done");
    expect(run.found).toBe(6);
    expect(run.added).toBe(1);
    expect(run.leftOut).toMatchObject({ "already seen": 1, "posting closed": 2, "skipped board": 1, "too old": 1 });
    // #121: each reason keeps the postings behind it, so the Runs tab can open the group.
    expect(run.leftOutItems["skipped board"]).toEqual([{ title: null, company: null, url: "https://www.linkedin.com/jobs/view/1" }]);
    expect(run.leftOutItems["posting closed"]!.map((item) => item.url)).toEqual(["https://jobs.lever.co/northstar/closed", "https://jobs.lever.co/northstar/gone"]);
    expect(run.leftOutItems["too old"]).toHaveLength(1);
    const [found] = state.items;
    expect(found.url).toBe("https://jobs.lever.co/northstar/abc");
    expect(found.postedAt).toBe("2026-11-03");

    const pasteId = "paste-test-0001";
    expect(await stageFoundJob(workspace, found.id, pasteId)).toContain("Solutions Engineer");
    expect(await readFile(join(workspace, ".sensei/staged-jds", `${pasteId}.md`), "utf8")).toContain("Strong SQL and Python");
    const jobId = await saveFoundJob(workspace, found.id);
    expect(await readFile(join(workspace, "jobs", jobId, "original_jd.md"), "utf8")).toContain("Northstar Labs");
    expect((await readSearchState(workspace)).items[0]).toMatchObject({ status: "saved", jobId });
    // Drafting that saved job later (from Jobs or the Saved tab) moves the match to "Sent for drafts".
    await markSavedJobQueued(workspace, "some-other-job");
    expect((await readSearchState(workspace)).items[0].status).toBe("saved");
    await markSavedJobQueued(workspace, jobId);
    expect((await readSearchState(workspace)).items[0]).toMatchObject({ status: "queued", jobId, autoQueued: false });

    // A second run never brings the same posting back, and never removes what's there.
    const again = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), runner: async () => ({ response: reply, conversationId: null }), now: () => new Date("2026-11-05T13:00:00Z") });
    expect(again.run.added).toBe(0);
    expect(again.state.items).toHaveLength(1);
    expect(again.state.runs).toHaveLength(2);
  });

  it("reports a failed Agy run without adding anything", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, settings);
    const { run } = await runSearch({ workspace, profile: null, existingKeys: new Set(), runner: async () => { throw new Error("Quota reached"); } });
    expect(run).toMatchObject({ status: "failed", error: "Agy's quota is used up for now. Try again later.", added: 0 });
  });
});

describe("public job boards", () => {
  const ashbyJobs = { jobs: [
    { title: "Solutions Engineer", jobUrl: "https://jobs.ashbyhq.com/northstar/live-1", location: "Remote", publishedAt: "2026-11-01T10:00:00Z", isListed: true },
    { title: "Account Executive", jobUrl: "https://jobs.ashbyhq.com/northstar/live-2", location: "Remote", publishedAt: "2026-11-01T10:00:00Z", isListed: true },
  ] };
  const page = `<html><head><title>Solutions Engineer</title></head><body><main>${POSTING.replace(/\n/g, "<br>")}</main></body></html>`;
  const fetcher = (async (url: string | URL) => {
    const target = String(url);
    if (target === "https://api.ashbyhq.com/posting-api/job-board/northstar?includeCompensation=true") return Response.json(ashbyJobs);
    if (target === "https://jobs.ashbyhq.com/northstar/live-1") return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
    return new Response("", { status: 404 });
  }) as typeof fetch;

  it("reads board links and matches titles", () => {
    expect(boardRef("https://jobs.ashbyhq.com/northstar/abc")).toEqual({ board: "ashby", slug: "northstar" });
    expect(boardRef("https://job-boards.greenhouse.io/acme/jobs/7")).toEqual({ board: "greenhouse", slug: "acme" });
    expect(boardRef("https://jobs.lever.co/acme")).toEqual({ board: "lever", slug: "acme" });
    expect(boardRef("https://example.com/jobs/1")).toBeNull();
    expect(titleSimilarity("Solutions Engineer (US)", "Solutions Engineer, East")).toBeGreaterThan(0.6);
    expect(fitsSearchTitles("Senior Solutions Engineer", ["solutions engineering"])).toBe(true);
    expect(fitsSearchTitles("Account Executive", ["solutions engineering"])).toBe(false);
  });

  it("swaps a dead link for the live posting with the same title and takes its date", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, settings);
    const reply = JSON.stringify({ jobs: [
      { url: "https://jobs.ashbyhq.com/northstar/made-up-id", title: "Solutions Engineer", company: "Northstar Labs" },
      { url: "https://jobs.ashbyhq.com/northstar/another-dead-id", title: "Data Scientist", company: "Northstar Labs" },
    ] });
    const { run, state } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), now: () => new Date("2026-11-05T12:00:00Z"), runner: async () => ({ response: reply, conversationId: null }) });
    expect(run).toMatchObject({ status: "done", added: 1, replaced: 1, leftOut: { "posting closed": 1 } });
    expect(state.items[0]).toMatchObject({ url: "https://jobs.ashbyhq.com/northstar/live-1", postedAt: "2026-11-01", board: "ashby" });
  });

  it("checks watched companies without Agy, keeping only titles that fit", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, { ...settings, watched: [{ board: "ashby", slug: "northstar", name: "Northstar Labs" }] });
    const { run, state } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), now: () => new Date("2026-11-05T12:00:00Z"), runner: null });
    expect(run).toMatchObject({ status: "done", source: "watched", found: 1, added: 1 });
    expect(state.items[0]).toMatchObject({ company: "Northstar Labs", watched: true, title: "Solutions Engineer" });
  });

  it("keeps watched results when Agy fails, and says so", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, { ...settings, watched: [{ board: "ashby", slug: "northstar", name: "Northstar Labs" }] });
    const { run } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), runner: async () => { throw new Error("print_timeout"); } });
    expect(run).toMatchObject({ status: "done", added: 1, error: "Agy took too long to search. Try fewer companies per search or fewer titles." });
  });
});

describe("Agy light rating", () => {
  it("picks new, unrated matches near the bar without blockers, at most 10", () => {
    const items = [item("a", 2.4), item("b", 2.6), item("c", 4.0, { agyFit: { score: 3, why: "", gaps: [], ratedAt: "x" } }), item("d", 3.5, { status: "dismissed" }),
      item("e", 4.8, { fit: { score: 4.8, why: "", covered: 0, total: 0, gaps: [], blockers: ["No visa sponsorship"], flags: [] } }), ...Array.from({ length: 12 }, (_, n) => item(`z${n}`, 3.1))];
    const picks = lightRatingPicks(items, { minFit: 3 });
    expect(picks).toHaveLength(10);
    expect(picks.map((entry) => entry.id)).not.toEqual(expect.arrayContaining(["a", "c", "d", "e"]));
  });

  it("asks with the card and requirements only, and keeps only known ids", () => {
    const prompt = buildRatingPrompt("Roles: Support Engineer (2022 – present)", [{ id: "find-abc1", title: "Solutions Engineer", company: "Northstar Labs", level: "mid", requirements: ["Strong SQL"] }]);
    expect(prompt).toContain("do not search, read files");
    // #109: the job's own text sits inside the posting fence, after its id.
    expect(prompt).toContain("Job find-abc1:\n<posting>\nSolutions Engineer at Northstar Labs (mid)");
    expect(prompt).toContain("- Strong SQL");
    const parsed = parseRatingReply('{"ratings":[{"id":"find-abc1","score":7,"why":"Close **match**.","gaps":["Kotlin","a","b","c"]},{"id":"find-other","score":4,"why":"x"}]}', ["find-abc1"]);
    expect([...parsed.keys()]).toEqual(["find-abc1"]);
    expect(parsed.get("find-abc1")).toEqual({ score: 5, why: "Close match.", gaps: ["Kotlin", "a", "b"] });
  });

  it("rates a search's best new matches in one call, and Agy's score ranks them", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, { ...settings, minFit: 1 });
    const page = `<html><head><title>Northstar Labs - Solutions Engineer</title></head><body><main>${POSTING.replace(/\n/g, "<br>")}</main></body></html>`;
    const fetcher = (async (url: string | URL) => String(url) === "https://jobs.lever.co/northstar/abc" ? new Response(page, { status: 200, headers: { "content-type": "text/html" } }) : new Response("", { status: 404 })) as typeof fetch;
    let calls = 0;
    const rater = async (prompt: string) => { calls += 1; const id = /Job (find-[a-z0-9-]+):/.exec(prompt)![1]; return { response: JSON.stringify({ ratings: [{ id, score: 4.4, why: "Strong overlap.", gaps: ["Kotlin"] }] }), conversationId: null }; };
    const { run, state } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), rater, runner: async () => ({ response: JSON.stringify({ jobs: [{ url: "https://jobs.lever.co/northstar/abc" }] }), conversationId: null }) });
    expect(calls).toBe(1);
    expect(run).toMatchObject({ added: 1, rated: 1 });
    expect(state.items[0].agyFit).toMatchObject({ score: 4.4, why: "Strong overlap.", gaps: ["Kotlin"] });
    expect(effectiveFit(state.items[0])).toBe(4.4);
  });
});

describe("left-out postings can come back", () => {
  it("brings back a posting left out as too old once the age limit is raised, but never a closed one", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    const page = `<html><head><title>Northstar Labs - Solutions Engineer</title></head><body><main>${POSTING.replace(/\n/g, "<br>")}</main></body></html>`;
    const fetcher = (async (url: string | URL) => {
      const target = String(url);
      if (target === "https://api.ashbyhq.com/posting-api/job-board/northstar?includeCompensation=true") return Response.json({ jobs: [{ title: "Solutions Engineer", jobUrl: "https://jobs.ashbyhq.com/Northstar/live-1", publishedAt: "2026-09-20T10:00:00Z", isListed: true }] });
      if (target.toLowerCase() === "https://jobs.ashbyhq.com/northstar/live-1") return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const reply = JSON.stringify({ jobs: [{ url: "https://jobs.ashbyhq.com/northstar/live-1", title: "Solutions Engineer" }, { url: "https://jobs.ashbyhq.com/northstar/gone-9", title: "Data Scientist" }] });
    const runner = async () => ({ response: reply, conversationId: null });
    const now = () => new Date("2026-11-06T12:00:00Z");
    expect(DEFAULT_JOB_SEARCH_SETTINGS.postedWithinDays).toBe(30);
    await saveSearchSettings(workspace, { ...settings, postedWithinDays: 14 });
    const first = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), runner, now });
    expect(first.run).toMatchObject({ added: 0, leftOut: { "too old": 1, "posting closed": 1 } });
    await saveSearchSettings(workspace, { ...settings, postedWithinDays: 60 });
    const second = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), runner, now });
    expect(second.run).toMatchObject({ added: 1, leftOut: { "already seen": 1 } });
    expect(second.state.items[0]).toMatchObject({ title: "Solutions Engineer", postedAt: "2026-09-20" });
  });
});

describe("job search: places, companies, and board postings", () => {
  const ashby = (jobs: Array<Record<string, unknown>>) => Response.json({ jobs: jobs.map((job) => ({ isListed: true, descriptionHtml: `<h2>Requirements</h2><ul><li>Strong SQL and Python for data troubleshooting</li><li>Experience running technical discovery with customers</li><li>Clear writing for technical and business audiences</li></ul><p>${"Northstar Labs builds data tools for retail teams and helps customers launch. ".repeat(8)}</p>`, ...job })) });
  const settingsBay = { ...settings, locations: ["SF Bay Area"], workSetups: ["remote", "hybrid"] as Array<"remote" | "hybrid" | "onsite"> };

  it("matches places through metro areas and keeps remote jobs only inside the US", () => {
    expect(locationFits({ locations: ["Oakland, CA"], workplace: "hybrid" }, settingsBay)).toEqual({ fits: true, reason: "in your area" });
    expect(locationFits({ locations: ["New York, NY"], workplace: "hybrid" }, settingsBay).fits).toBe(false);
    expect(locationFits({ locations: ["Remote - US"], workplace: "remote" }, settingsBay).fits).toBe(true);
    expect(locationFits({ locations: ["Remote - UK"], workplace: "remote" }, settingsBay).fits).toBe(false);
    expect(locationFits({ locations: ["San Francisco"], workplace: "onsite" }, settingsBay).reason).toBe("onsite (not in your work setups)");
    expect(locationFits({ locations: ["Austin, TX"], workplace: "onsite" }, { locations: [], workSetups: ["onsite"] }).fits).toBe(true);
    expect(locationFits({ locations: [], workplace: null }, settingsBay).fits).toBe(true);
    expect(placesFor("San Francisco Bay Area")).toEqual(expect.arrayContaining(["san francisco", "san leandro", "palo alto"]));
  });

  it("puts every search field the user wrote into Agy's prompt", () => {
    const prompt = buildSearchPrompt({ ...settings, titles: ["Partner Engineer"], locations: ["Denver"], includeKeywords: ["APIs"], excludeKeywords: ["commission only"], skipCompanies: ["Acme"], extraSites: ["jobs.example.com"], skipSites: ["badboard.com"], resultsPerRun: 12 }, [], new Date("2026-11-10T00:00:00Z"), ["Northstar Labs"]);
    for (const text of ["Partner Engineer", "Denver", "APIs", "commission only", "Acme", "jobs.example.com", "badboard.com", "12 companies", "Northstar Labs", "welcometothejungle.com"]) expect(prompt).toContain(text);
  });

  it("reads companies Agy names from their own boards, builds postings from board data, and watches them", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, settingsBay);
    const pageLoads: string[] = [];
    const fetcher = (async (url: string | URL) => {
      const target = String(url);
      if (target === "https://api.ashbyhq.com/posting-api/job-board/northstar?includeCompensation=true") return ashby([
        { title: "Solutions Engineer", jobUrl: "https://jobs.ashbyhq.com/northstar/se-1", location: "San Francisco", workplaceType: "Hybrid", publishedAt: "2026-11-05T10:00:00Z" },
        { title: "Solutions Engineer", jobUrl: "https://jobs.ashbyhq.com/northstar/se-2", location: "London", workplaceType: "OnSite", publishedAt: "2026-11-05T10:00:00Z" },
        { title: "Account Executive", jobUrl: "https://jobs.ashbyhq.com/northstar/ae-1", location: "Remote - US", workplaceType: "Remote", publishedAt: "2026-11-05T10:00:00Z" },
      ]);
      pageLoads.push(target);
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const reply = JSON.stringify({ companies: [{ name: "Northstar Labs", jobsUrl: "https://jobs.ashbyhq.com/northstar" }, { name: "Elsewhere", jobsUrl: "https://elsewhere.example.com/careers" }] });
    const { run, state } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), runner: async () => ({ response: reply, conversationId: null }), now: () => new Date("2026-11-10T12:00:00Z") });
    expect(run).toMatchObject({ status: "done", added: 1, companies: 1, leftOut: { "not in your places or setups": 1, "company not on a readable board": 1 } });
    expect(run.leftOutItems["company not on a readable board"]).toEqual([{ title: null, company: "Elsewhere", url: "https://elsewhere.example.com/careers" }]);
    expect(state.items[0]).toMatchObject({ url: "https://jobs.ashbyhq.com/northstar/se-1", company: "Northstar Labs", postedAt: "2026-11-05" });
    expect(pageLoads.filter((url) => url.includes("jobs.ashbyhq.com/northstar/se-1"))).toEqual([]);
    expect((await readSearchSettings(workspace, null)).watched).toEqual([{ board: "ashby", slug: "northstar", name: "Northstar Labs", source: "search" }]);
  });

  it("watches the companies of the user's jobs and stops at the per-run limit, newest first", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, { ...settingsBay, maxNewPerRun: 5 });
    const jobs = Array.from({ length: 7 }, (_, n) => ({ title: `Solutions Engineer ${["", "II", "III", "IV", "V", "VI", "VII"][n]}`.trim(), jobUrl: `https://jobs.ashbyhq.com/northstar/se-${n}`, location: "Oakland", workplaceType: "Hybrid", publishedAt: `2026-11-0${n + 1}T10:00:00Z` }));
    const fetcher = (async (url: string | URL) => String(url).includes("api.ashbyhq.com") ? ashby(jobs) : new Response("", { status: 404 })) as typeof fetch;
    const { run, state } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), runner: null, jobCompanies: [{ board: "ashby", slug: "northstar", name: "Northstar Labs", jobs: 2, interviewed: true }], now: () => new Date("2026-11-10T12:00:00Z") });
    expect(run).toMatchObject({ added: 5, leftOut: { "over this run's limit": 2 } });
    expect(state.items.map((item) => item.postedAt)).toEqual(["2026-11-07", "2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03"]);
    expect((await readSearchSettings(workspace, null)).watched[0]).toMatchObject({ slug: "northstar", source: "jobs" });
  });
});

describe("job search: fixes from the first live check", () => {
  const anywhere = { locations: [] as string[], workSetups: ["remote", "hybrid", "onsite"] as Array<"remote" | "hybrid" | "onsite"> };
  it("keeps remote jobs only when they're in the US or name no place", () => {
    expect(locationFits({ locations: ["Korea"], workplace: "remote" }, anywhere).fits).toBe(false);
    expect(locationFits({ locations: ["Remote - Europe"], workplace: "remote" }, anywhere).fits).toBe(false);
    expect(locationFits({ locations: ["Remote"], workplace: "remote" }, anywhere).fits).toBe(true);
    expect(locationFits({ locations: ["New York"], workplace: "remote" }, anywhere).fits).toBe(true);
    expect(locationFits({ locations: ["Denver, CO"], workplace: "onsite" }, anywhere).fits).toBe(true);
    expect(locationFits({ locations: ["Seoul"], workplace: "onsite" }, anywhere).fits).toBe(false);
  });

  it("needs the search title's words in one part of the job title", () => {
    expect(fitsSearchTitles("Sr. Software Engineer - Investor Solutions", ["solutions engineering"])).toBe(false);
    expect(fitsSearchTitles("Senior Solutions Engineer, Enterprise", ["solutions engineering"])).toBe(true);
    expect(fitsSearchTitles("Forward Deployed Engineering Lead", ["forward deployed engineer"])).toBe(true);
  });

  it("treats the same role posted per city as one job", () => {
    expect(jobKey("TribalScale", "Forward Deployed Engineer (Atlanta, Georgia)")).toBe(jobKey("TribalScale", "Forward Deployed Engineer (New York)"));
    expect(jobKey("Acme", "Solutions Engineer - Austin, TX")).toBe(jobKey("Acme", "Solutions Engineer"));
    expect(jobKey("Acme", "Solutions Engineer")).not.toBe(jobKey("Acme", "Solutions Architect"));
  });
});

describe("job search: words to leave out of titles", () => {
  it("leaves out titles with the user's words as whole words, including short forms", () => {
    const words = ["Senior", "Principal", "Lead"];
    expect(titleExcluded("Senior Solutions Engineer", words)).toBe("Senior");
    expect(titleExcluded("Sr. Solutions Engineer", words)).toBe("Senior");
    expect(titleExcluded("Forward Deployed Engineering Lead", words)).toBe("Lead");
    expect(titleExcluded("Solutions Engineer, Lead Generation Tools", words)).toBe("Lead");
    expect(titleExcluded("Solutions Engineer, Leading Accounts", words)).toBeNull();
    expect(titleExcluded("Solutions Engineer II", words)).toBeNull();
  });

  it("tells Agy and skips matching board jobs", async () => {
    expect(buildSearchPrompt({ ...settings, excludeTitleWords: ["Senior", "Staff"] }, [])).toContain("Leave out roles whose title includes: Senior, Staff");
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, { ...settings, excludeTitleWords: ["Senior"], watched: [{ board: "ashby", slug: "northstar", name: "Northstar Labs", source: "user" }] });
    const body = `<ul><li>Strong SQL and Python for data troubleshooting</li><li>Technical discovery with customers</li></ul><p>${"Northstar Labs helps retail teams launch data tools. ".repeat(10)}</p>`;
    const fetcher = (async () => Response.json({ jobs: [
      { title: "Senior Solutions Engineer", jobUrl: "https://jobs.ashbyhq.com/northstar/s1", location: "Remote - US", workplaceType: "Remote", publishedAt: "2026-11-05T10:00:00Z", isListed: true, descriptionHtml: body },
      { title: "Solutions Engineer", jobUrl: "https://jobs.ashbyhq.com/northstar/s2", location: "Remote - US", workplaceType: "Remote", publishedAt: "2026-11-05T10:00:00Z", isListed: true, descriptionHtml: body },
    ] })) as typeof fetch;
    const { run, state } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), runner: null, now: () => new Date("2026-11-10T12:00:00Z") });
    expect(run).toMatchObject({ added: 1, leftOut: { "title has a word you left out": 1 } });
    expect(state.items[0].title).toBe("Solutions Engineer");
  });
});

describe("Filtered out breakdown (#121)", () => {
  it("shows one group per reason, largest first, with its examples and how many more", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { LeftOutBreakdown } = await import("../src/renderer/JobSearchView");
    const html = renderToStaticMarkup(createElement(LeftOutBreakdown, { run: { leftOut: { "too old": 3, "skipped company": 1 }, leftOutItems: { "too old": [{ title: "Analyst", company: "Northstar Labs", url: "https://jobs.lever.co/northstar/old" }] } } }));
    expect(html).toContain("Filtered out: 4");
    expect(html.indexOf("too old")).toBeLessThan(html.indexOf("skipped company"));
    expect(html).toContain('<a href="https://jobs.lever.co/northstar/old" target="_blank" rel="noreferrer">Northstar Labs, Analyst</a>');
    expect(html).toContain("and 2 more");
    expect(html).toContain("No examples were kept for this run.");
  });
});

describe("posted date from the page (#116)", () => {
  it("leaves out a posting as too old when only its page says when it went up", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-search-"));
    await saveSearchSettings(workspace, settings);
    const page = `<html><head><title>Northstar Labs - Solutions Engineer</title><script type="application/ld+json">{"@type":"JobPosting","title":"Solutions Engineer","datePosted":"2026-07-01"}</script></head><body><main>${POSTING.replace(/\n/g, "<br>")}</main></body></html>`;
    const fetcher = (async (url: string | URL) => new Response(String(url) === "https://jobs.lever.co/northstar/dated" ? page : "", { status: String(url) === "https://jobs.lever.co/northstar/dated" ? 200 : 404, headers: { "content-type": "text/html" } })) as typeof fetch;
    const reply = JSON.stringify({ jobs: [{ url: "https://jobs.lever.co/northstar/dated", title: "Solutions Engineer", company: "Northstar Labs" }] });
    const { run } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), now: () => new Date("2026-11-05T12:00:00Z"), runner: async () => ({ response: reply, conversationId: null }) });
    expect(run).toMatchObject({ added: 0, leftOut: { "too old": 1 } });
  });
});
