// Workday postings are read from the site's public CXS job API (issue #49). The tenant and posting are fictional.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageLinkJobDescription, workdayCompany } from "../electron/jd-fetch";

const API = "https://northstar.wd5.myworkdayjobs.com/wday/cxs/northstar/Careers/job/Remote-USA/Customer-Success-Manager_R1234";
const DESCRIPTION = `<p>About the role</p><ul>${Array.from({ length: 10 }, (_, index) => `<li>Guide Northstar Labs customers through onboarding stage ${index + 1} and report what they need.</li>`).join("")}</ul>`;
const JOB = {
  jobPostingInfo: { title: "Customer Success Manager", jobDescription: DESCRIPTION, location: "Remote, USA", startDate: "2026-11-10", timeType: "Full time", jobReqId: "R1234", remoteType: "Remote", externalUrl: "https://northstar.wd5.myworkdayjobs.com/Careers/job/Remote-USA/Customer-Success-Manager_R1234" },
  hiringOrganization: { name: "100 Northstar Labs Holdings LLC" },
};

function fakeFetch(seen: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    return url === API ? new Response(JSON.stringify(JOB), { status: 200 }) : new Response("<html><body></body></html>", { status: 200 });
  }) as typeof fetch;
}

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("Workday postings", () => {
  for (const link of [
    "https://northstar.wd5.myworkdayjobs.com/en-US/Careers/job/Remote-USA/Customer-Success-Manager_R1234",
    "https://northstar.wd5.myworkdayjobs.com/Careers/job/Remote-USA/Customer-Success-Manager_R1234/apply",
  ]) {
    it(`reads ${link.includes("/apply") ? "an apply link" : "a posting link"} from the job API`, async () => {
      const root = await mkdtemp(join(tmpdir(), "workday-"));
      temps.push(root);
      const seen: string[] = [];
      const meta = await stageLinkJobDescription(root, link, "paste-workday1", fakeFetch(seen));
      expect(seen[0]).toBe(API);
      expect(meta).toMatchObject({ title: "Customer Success Manager", company: "Northstar", location: "Remote, USA", url: link });
      const text = await readFile(join(root, ".sensei", "staged-jds", "paste-workday1.md"), "utf8");
      expect(text).toContain("onboarding stage 10");
      expect(text).toContain("Work setup: Remote");
      expect(text).toContain("Posted: 2026-11-10");
    });
  }

  it("names the company from the tenant unless the legal entity names it", () => {
    expect(workdayCompany("northstar", "100 Northstar Labs Holdings LLC")).toBe("Northstar");
    expect(workdayCompany("northstar", "Northstar Labs, Inc.")).toBe("Northstar Labs, Inc.");
    expect(workdayCompany("acme-corp", null)).toBe("Acme Corp");
  });
});
