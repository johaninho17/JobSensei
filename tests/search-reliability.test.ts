// Job Search reliability fixes (Gemini eval, 2026-11-11): Agy's companies resolve to boards, the search budget, Ashby
// pay, stale postings, the wall-clock deadline for headless Agy, and cleaning up its conversations.
import { chmod, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardRef, postingRef, singlePosting } from "../src/shared/boards";
import { formatPay } from "../src/shared/pay";
import { pruneHeadlessConversations, recordHeadlessConversation } from "../electron/agy-home";
import { legacyHeadlessConversations } from "../electron/agy-cleanup";
import { extractJobDescription, postingFromBoard } from "../electron/jd-fetch";
import { ashbyPay, leverPay } from "../electron/job-boards";
import { KNOWN_COMPANIES_MAX, MAX_WEB_SEARCHES, SEARCH_SCHEMA, buildSearchPrompt, findBoardByName, slugGuesses, parseSearchResult, readSearchSettings, runSearch, saveSearchSettings } from "../electron/job-search";
import { cleanPosting } from "../electron/posting-clean";
import { parsePay } from "../electron/posting-record";
import { headlessAgy } from "../electron/question-agent";

describe("Agy's companies resolve to readable boards", () => {
  it("reads Ashby's app links like its jobs links", () => {
    expect(boardRef("https://app.ashbyhq.com/northstar/0f0e-1234")).toEqual({ board: "ashby", slug: "northstar" });
    expect(postingRef("https://app.ashbyhq.com/northstar/0f0e-1234")).toMatchObject({ board: "ashby", slug: "northstar", id: "0f0e-1234", origin: "https://jobs.ashbyhq.com" });
    expect(singlePosting("https://app.ashbyhq.com/northstar/0f0e-1234")).toBe(true);
    expect(singlePosting("https://app.ashbyhq.com/northstar")).toBe(false);
  });

  it("turns a posting given as a company's jobs page into the board, and checks the posting too", () => {
    const reply = parseSearchResult(JSON.stringify({ companies: [
      { name: "Northstar Labs", jobsUrl: "https://jobs.ashbyhq.com/northstar/abc-123" },
      { name: "Harbor", jobsUrl: "https://job-boards.greenhouse.io/harbor" },
    ], jobs: [] }));
    expect(reply.companies).toEqual([{ name: "Northstar Labs", jobsUrl: "https://jobs.ashbyhq.com/northstar" }, { name: "Harbor", jobsUrl: "https://job-boards.greenhouse.io/harbor" }]);
    expect(reply.jobs).toEqual([expect.objectContaining({ url: "https://jobs.ashbyhq.com/northstar/abc-123", company: "Northstar Labs" })]);
  });

  it("tells Agy its search budget, every known company, and to keep a link for every company", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-reliable-"));
    const settings = { ...(await readSearchSettings(workspace, null)), titles: ["Solutions Engineer"] };
    const known = Array.from({ length: 300 }, (_value, index) => `Company ${index}`);
    const prompt = buildSearchPrompt(settings, [], new Date("2026-11-11T12:00:00Z"), known);
    expect(prompt).toContain(`at most ${MAX_WEB_SEARCHES} web searches`);
    // Agy's web search only gives redirect links; refusing them made it drop companies (2026-11-11), so it keeps them.
    expect(prompt).toContain("even a redirect (the app follows redirects)");
    expect(prompt).toMatch(new RegExp(`Company ${KNOWN_COMPANIES_MAX - 1}(?!\\d)`));
    expect(prompt).not.toMatch(new RegExp(`Company ${KNOWN_COMPANIES_MAX}(?!\\d)`));
  });

  it("resolves a redirect company link, skips companies already watched, and leaves old board postings out without marking them seen", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-reliable-"));
    const settings = await readSearchSettings(workspace, null);
    await saveSearchSettings(workspace, { ...settings, titles: ["Solutions Engineer"], postedWithinDays: 30, lightRating: false, watchFoundCompanies: false,
      watched: [{ board: "ashby", slug: "watched-co", name: "Watched Co" }] });
    const reads: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const target = String(input);
      reads.push(target);
      if (target.startsWith("https://vertexaisearch.cloud.google.com/")) return new Response(null, { status: 302, headers: { location: "https://jobs.ashbyhq.com/fresh-co" } });
      if (target.startsWith("https://api.ashbyhq.com/posting-api/job-board/watched-co")) return Response.json({ jobs: [] });
      if (target.startsWith("https://api.ashbyhq.com/posting-api/job-board/fresh-co")) return Response.json({ jobs: [
        { title: "Solutions Engineer", jobUrl: "https://jobs.ashbyhq.com/fresh-co/new-1", location: "Remote", isRemote: true, publishedAt: "2026-11-05T00:00:00Z", descriptionHtml: "<p>" + "Help customers set up the product, answer their technical questions, and work with engineering on fixes. ".repeat(4) + "</p>", compensation: { scrapeableCompensationSalarySummary: "$140K - $165K" } },
        { title: "Solutions Engineer II", jobUrl: "https://jobs.ashbyhq.com/fresh-co/old-1", location: "Remote", isRemote: true, publishedAt: "2026-06-01T00:00:00Z", descriptionHtml: "<p>Old.</p>" },
      ] });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const runner = async () => ({ response: JSON.stringify({ companies: [
      { name: "Fresh Co", jobsUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc" },
      { name: "Watched Co", jobsUrl: "https://jobs.ashbyhq.com/watched-co" },
    ], jobs: [] }), conversationId: null });
    const { run, state } = await runSearch({ workspace, profile: null, fetcher, existingKeys: new Set(), now: () => new Date("2026-11-11T12:00:00Z"), runner, rater: null });
    expect(run.leftOut, reads.join(" | ")).toMatchObject({ "already watched": 1, "too old": 1 });
    expect(run.leftOut["couldn't read"], reads.join(" | ")).toBeUndefined();
    expect(run, JSON.stringify(run)).toMatchObject({ status: "done", found: 1, added: 1, companies: 1 });
    expect(reads.filter((url) => url.includes("job-board/watched-co"))).toHaveLength(1);
    expect(state.seen.some((url) => url.includes("old-1"))).toBe(false);
    expect(state.items[0]).toMatchObject({ company: "Fresh Co" });
  });
});

describe("companies Agy names without a link", () => {
  it("must come with a link, and are otherwise found on their board by name", async () => {
    expect(JSON.parse(SEARCH_SCHEMA).properties.companies.items.required).toEqual(["name", "jobsUrl"]);
    expect(slugGuesses("Together AI, Inc.")).toEqual(["togetherai", "together-ai"]);
    expect(slugGuesses("Northstar")).toEqual(["northstar"]);
    const boards: Record<string, number> = { "greenhouse:togetherai": 3, "ashby:together-ai": 0 };
    const read = async (ref: { board: string; slug: string }) => { const count = boards[`${ref.board}:${ref.slug}`]; return count === undefined ? null : Array.from({ length: count }, () => ({}) as never); };
    expect(await findBoardByName("Together AI", read)).toEqual({ board: "greenhouse", slug: "togetherai" });
    expect(await findBoardByName("Unknown Co", read)).toBeNull();
  });
});

describe("Ashby pay is kept", () => {
  it("reads Ashby's compensation panel and Lever's salary range", () => {
    expect(ashbyPay({ compensationTierSummary: "$145K – $175K • Offers Equity" })).toBe("$145K – $175K • Offers Equity");
    expect(ashbyPay({ scrapeableCompensationSalarySummary: "$145K - $175K", compensationTierSummary: "x" })).toBe("$145K - $175K");
    expect(ashbyPay({})).toBeNull();
    expect(leverPay({ min: 120000, max: 150000, currency: "USD", interval: "per-year-salary" })).toBe("$120,000 – $150,000 a year");
    expect(formatPay(40, null, "USD", "HOUR")).toBe("$40 an hour");
  });

  it("puts board pay in the posting header, where the posting record reads it", () => {
    const { extracted } = postingFromBoard({ url: "https://jobs.ashbyhq.com/northstar/abc", title: "Customer Data Analyst", company: "Northstar Labs", location: "Remote", html: "<p>Work with customers.</p>", pay: "$145K – $175K" });
    expect(extracted.markdown).toContain("**Compensation:** $145K – $175K");
    expect(parsePay(extracted.markdown)).toMatchObject({ min: 145000, max: 175000 });
  });

  it("reads pay from a page's structured data, or Ashby's embedded summary when there is none", () => {
    const ld = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Analyst", hiringOrganization: { name: "Northstar Labs" }, description: "<p>Do analysis.</p>", baseSalary: { currency: "USD", value: { minValue: 145000, maxValue: 175000, unitText: "YEAR" } } })}</script>`;
    const fromLd = extractJobDescription(`<html><head>${ld}</head><body></body></html>`, "https://jobs.ashbyhq.com/northstar/abc");
    expect(fromLd.markdown).toContain("**Compensation:** $145,000 – $175,000 a year");
    const cleaned = cleanPosting(fromLd.markdown, { title: fromLd.title, company: fromLd.company, location: fromLd.location, source: fromLd.url }).markdown;
    expect(parsePay(cleaned)).toMatchObject({ min: 145000, max: 175000, period: "year" });
    const ldNoPay = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Analyst", description: "<p>Do analysis.</p>" })}</script>`;
    const embedded = extractJobDescription(`<html><head>${ldNoPay}</head><body><script>window.__appData = {"posting":{"scrapeableCompensationSalarySummary":"$145K \\u2013 $175K"}}</script></body></html>`, "https://jobs.ashbyhq.com/northstar/abc");
    expect(embedded.markdown).toContain("**Compensation:** $145K – $175K");
  });
});

describe("headless Agy", () => {
  it("ends a run on the wall clock even when timers were paused (sleep)", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sensei-agy-"));
    const fake = join(folder, "agy");
    await writeFile(fake, "#!/bin/sh\nsleep 30\n");
    await chmod(fake, 0o755);
    let time = 0;
    // The clock jumps an hour on the first check: the computer slept through Agy's limit.
    const runner = headlessAgy({ agyPath: fake, agyHome: folder, cwd: folder, timeoutSeconds: 60, clock: () => (time += 3_600_000), checkMs: 50 });
    const started = Date.now();
    await expect(runner("prompt", { conversationId: null })).rejects.toThrow(/print_timeout/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("cleans up only the conversations background runs recorded, keeping recent ones", async () => {
    const home = await mkdtemp(join(tmpdir(), "sensei-agyhome-"));
    const cli = join(home, ".gemini", "antigravity-cli");
    await mkdir(join(cli, "conversations"), { recursive: true });
    await mkdir(join(cli, "brain"), { recursive: true });
    const ids = Array.from({ length: 4 }, (_value, index) => `conv-0000-${index}`);
    for (const id of [...ids, "terminal-run-0001"]) {
      await writeFile(join(cli, "conversations", `${id}.db`), "x");
      await mkdir(join(cli, "brain", id), { recursive: true });
    }
    const now = new Date("2026-11-11T12:00:00Z");
    for (const [index, id] of ids.entries()) await recordHeadlessConversation(home, id, new Date(now.getTime() - (index * 10) * 86_400_000));
    const removed = await pruneHeadlessConversations(home, { olderThanDays: 14, keep: 1, now });
    expect(removed.sort()).toEqual(["conv-0000-2", "conv-0000-3"]);
    expect((await readdir(join(cli, "conversations"))).sort()).toEqual(["conv-0000-0.db", "conv-0000-1.db", "terminal-run-0001.db"]);
    expect((await readdir(join(cli, "brain"))).sort()).toEqual(["conv-0000-0", "conv-0000-1", "terminal-run-0001"]);
  });

  it("finds old background conversations from before recording by their prompt, never the terminal's", async () => {
    const home = await mkdtemp(join(tmpdir(), "sensei-agyhome-"));
    const folder = join(home, ".gemini", "antigravity-cli", "conversations");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "search-0001.db"), "header Find up to 20 companies in the United States ...");
    await writeFile(join(folder, "answers-001.db"), "header You are helping the candidate with the written questions ...");
    await writeFile(join(folder, "terminal-001.db"), "header Run sensei jd:fetch --staged paste-1 ...");
    const found = await legacyHeadlessConversations(home, { olderThanDays: 0, now: new Date(Date.now() + 1000) });
    expect(found.map((entry) => entry.id).sort()).toEqual(["answers-001", "search-0001"]);
  });
});
