// More careers sites read from their public posting APIs (#52), and plain pages without their site chrome.
// Every company and posting is fictional.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mainContent, stageLinkJobDescription } from "../electron/jd-fetch";
import { parsePay } from "../electron/posting-record";

const TEXT = `<ul>${Array.from({ length: 10 }, (_, index) => `<li>Support Northstar Labs customers through setup step ${index + 1} and share what they need.</li>`).join("")}</ul>`;
const fakeFetch = (pages: Record<string, unknown>): typeof fetch => (async (input: string | URL | Request) => {
  const body = pages[String(input)];
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function save(url: string, pages: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "careers-"));
  temps.push(root);
  const meta = await stageLinkJobDescription(root, url, "paste-careers1", fakeFetch(pages));
  return { meta, text: await readFile(join(root, ".sensei", "staged-jds", "paste-careers1.md"), "utf8") };
}

describe("careers site APIs", () => {
  it("reads SmartRecruiters", async () => {
    const { meta, text } = await save("https://jobs.smartrecruiters.com/NorthstarLabs/744000000000001-support-lead", {
      "https://api.smartrecruiters.com/v1/companies/NorthstarLabs/postings/744000000000001": {
        name: "Support Lead", refNumber: "NS-1", releasedDate: "2026-11-01T00:00:00Z", company: { name: "Northstar Labs" }, typeOfEmployment: { label: "Full-time" },
        location: { fullLocation: "DENVER, CO, United States", hybrid: true }, jobAd: { sections: { jobDescription: { title: "Job Description", text: TEXT } } },
      },
    });
    expect(meta).toMatchObject({ title: "Support Lead", company: "Northstar Labs" });
    expect(text).toContain("**Location:** Denver, CO");
    expect(text).toContain("**Work setup:** Hybrid");
    expect(text).toContain("**Job ID:** NS-1");
  });

  it("reads Workable, with the company from the account", async () => {
    const { meta, text } = await save("https://apply.workable.com/northstar/j/ABC123/", {
      "https://apply.workable.com/api/v2/accounts/northstar/jobs/ABC123": { title: "Onboarding Specialist", description: TEXT, requirements: "<ul><li>Two years in support</li></ul>", published: "2026-10-01T00:00:00Z", workplace: "remote", location: { city: "", country: "United States" } },
      "https://apply.workable.com/api/v1/accounts/northstar": { name: "Northstar Labs" },
    });
    expect(meta).toMatchObject({ title: "Onboarding Specialist", company: "Northstar Labs" });
    expect(text).toContain("**Work setup:** Remote");
    expect(text).toContain("## Requirements");
  });

  it("reads Recruitee", async () => {
    const { meta, text } = await save("https://northstar.recruitee.com/o/renewals-manager", {
      "https://northstar.recruitee.com/api/offers/renewals-manager": { offer: { title: "Renewals Manager", description: TEXT, company_name: "Northstar Labs", location: "Amsterdam, Netherlands", published_at: "2026-11-11 13:21:40 UTC", employment_type_code: "fulltime_permanent" } },
    });
    expect(meta).toMatchObject({ title: "Renewals Manager", company: "Northstar Labs" });
    expect(text).toContain("**Employment type:** Full-time");
    expect(text).toContain("**Posted:** 2026-11-11");
  });
});

describe("plain careers pages", () => {
  it("drops menus, headers, footers, and cookie banners", () => {
    const html = `<header>Northstar menu Products Pricing</header><nav>Jobs Teams Blog</nav><div class="cookie-banner">We use cookies</div><main><h1>Support Lead</h1>${TEXT}</main><footer>© Northstar Labs</footer>`;
    const main = mainContent(html);
    expect(main).toContain("setup step 10");
    expect(main).not.toMatch(/Pricing|Blog|cookies|©/);
  });

  it("writes pay without a trailing comma", () => {
    expect(parsePay("Base salary: $143,200 - $243,400, plus equity.")?.text).toBe("$143,200–$243,400/year");
  });
});
