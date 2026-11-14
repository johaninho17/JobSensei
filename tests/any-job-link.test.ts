// Reading a job link from any company site: an embedded board is followed, pages built with JavaScript are read
// through the app's browser reader, and sign-in walls get a clear message. Every company and posting is fictional.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { embeddedPostingUrl, setPageRenderer, stageLinkJobDescription } from "../electron/jd-fetch";

const DESCRIPTION = Array.from({ length: 12 }, (_, index) => `<li>Help Northstar Labs customers with onboarding step ${index + 1}, from first call to a working setup.</li>`).join("");
const posting = (title: string) => `<html><head><title>${title}</title><script type="application/ld+json">${JSON.stringify({
  "@type": "JobPosting", title, hiringOrganization: { name: "Northstar Labs" }, description: `<p>About the role</p><ul>${DESCRIPTION}</ul>`,
})}</script></head><body></body></html>`;

function fakeFetch(pages: Record<string, string>, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const body = pages[url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  }) as typeof fetch;
}

const temps: string[] = [];
async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "any-link-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  setPageRenderer(null);
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("job links from any company site", () => {
  it("follows a Greenhouse posting embedded in a company careers page (gh_jid)", async () => {
    const company = "https://careers.northstar.example/jobs?gh_jid=4012345";
    const board = "https://job-boards.greenhouse.io/northstarlabs/jobs/4012345";
    const page = `<html><body><div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=northstarlabs"></script></body></html>`;
    expect(embeddedPostingUrl(page, company)).toBe(board);
    const root = await workspace();
    const meta = await stageLinkJobDescription(root, company, "paste-case1", fakeFetch({ [company]: page, [board]: posting("Customer Onboarding Specialist") }));
    expect(meta).toMatchObject({ title: "Customer Onboarding Specialist", company: "Northstar Labs", url: company });
  });

  it("reads an embedded Greenhouse posting from the board's job API, keeping the company page as its link (#50)", async () => {
    const company = "https://careers.northstar.example/detail/88/?gh_jid=88";
    const page = `<script src="https://boards.greenhouse.io/embed/job_board/js?for=northstarlabs"></script>`;
    const api = { title: "Renewals Manager", company_name: "Northstar Labs", location: { name: "Denver, CO" }, content: `&lt;ul&gt;${DESCRIPTION.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}&lt;/ul&gt;` };
    const root = await workspace();
    const meta = await stageLinkJobDescription(root, company, "paste-case6", fakeFetch({ [company]: page, "https://boards-api.greenhouse.io/v1/boards/northstarlabs/jobs/88": JSON.stringify(api) }));
    expect(meta).toMatchObject({ title: "Renewals Manager", company: "Northstar Labs", location: "Denver, CO" });
    const text = await readFile(join(root, ".sensei", "staged-jds", "paste-case6.md"), "utf8");
    expect(text).toContain(`**Source:** ${company}`);
    expect(text).toContain("onboarding step 12");
  });

  it("follows an embedded application frame that names the board and the job", () => {
    const page = `<iframe src="https://boards.greenhouse.io/embed/job_app?for=northstarlabs&amp;token=777"></iframe>`;
    expect(embeddedPostingUrl(page, "https://northstar.example/role")).toBe("https://job-boards.greenhouse.io/northstarlabs/jobs/777");
  });

  it("follows an Ashby posting embedded with ashby_jid (#50)", () => {
    const page = `<div id="ashby_embed"></div><script src="https://jobs.ashbyhq.com/northstar/embed?version=2"></script>`;
    expect(embeddedPostingUrl(page, "https://northstar.example/careers?ashby_jid=1b2c3d4e-0000-4000-8000-00000000abcd"))
      .toBe("https://jobs.ashbyhq.com/northstar/1b2c3d4e-0000-4000-8000-00000000abcd");
  });

  it("follows gh_jid when the page links the board by its plain address (#50)", () => {
    expect(embeddedPostingUrl(`<a href="https://boards.greenhouse.io/northstarlabs">All jobs</a>`, "https://northstar.example/role?gh_jid=55"))
      .toBe("https://job-boards.greenhouse.io/northstarlabs/jobs/55");
  });

  it("reads the page as before when no board can be found (#50)", () => {
    expect(embeddedPostingUrl("<html><body>Our careers</body></html>", "https://northstar.example/role?gh_jid=55")).toBeNull();
  });

  it("doesn't follow a list page that links many postings", () => {
    const page = ["a1b2c3d4-0000-4000-8000-000000000001", "a1b2c3d4-0000-4000-8000-000000000002"].map((id) => `<a href="https://jobs.lever.co/northstar/${id}">Job</a>`).join("");
    expect(embeddedPostingUrl(page, "https://northstar.example/careers")).toBeNull();
  });

  it("reads a page built with JavaScript through the browser reader", async () => {
    const url = "https://northstar.wd1.myworkdayjobs.example/External/job/Remote/Support-Engineer_R123";
    const root = await workspace();
    const rendered: string[] = [];
    setPageRenderer(async (target) => { rendered.push(target); return posting("Support Engineer"); });
    const meta = await stageLinkJobDescription(root, url, "paste-case2", fakeFetch({ [url]: "<html><body><div id=root></div></body></html>" }));
    expect(rendered).toEqual([url]);
    expect(meta.title).toBe("Support Engineer");
    expect(await readFile(join(root, ".sensei", "staged-jds", "paste-case2.md"), "utf8")).toContain("onboarding step 12");
  });

  it("uses the browser reader when the site refuses plain requests", async () => {
    const url = "https://jobs.northstar.example/123";
    const root = await workspace();
    setPageRenderer(async () => posting("Account Manager"));
    expect((await stageLinkJobDescription(root, url, "paste-case3", fakeFetch({}))).title).toBe("Account Manager");
  });

  it("says to paste the posting when no reader can get the text", async () => {
    const url = "https://jobs.northstar.example/empty";
    const root = await workspace();
    await expect(stageLinkJobDescription(root, url, "paste-case4", fakeFetch({ [url]: "<html><body>Loading…</body></html>" }))).rejects.toThrow(/Paste the job description/);
  });

  it("explains sign-in walls on job aggregators", async () => {
    const url = "https://www.linkedin.com/jobs/view/123";
    const root = await workspace();
    setPageRenderer(async () => "<html><head><title>LinkedIn</title></head><body>Sign in to view this job on LinkedIn. Join now</body></html>");
    await expect(stageLinkJobDescription(root, url, "paste-case5", fakeFetch({ [url]: "<html><body>Sign in</body></html>" }))).rejects.toThrow(/only shows the posting after signing in/);
  });
});
