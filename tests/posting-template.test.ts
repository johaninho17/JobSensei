// Every saved posting has the same layout (#54): title, one facts block in a fixed order, then `##` sections.
// The requirement parser reads the same requirements before and after. All postings are fictional.
import { describe, expect, it } from "vitest";
import { extractJobDescription, postingFromBoard } from "../electron/jd-fetch";
import { cleanPosting } from "../electron/posting-clean";
import { buildPostingRecord } from "../electron/posting-record";
import { POSTING_FACTS, postingTemplate } from "../electron/posting-template";

const ITEMS = ["3+ years supporting customers of a software product", "Experience with SQL and spreadsheets", "Clear written communication"];
const SECTIONS = `<h2>About the role</h2><p>You will help Northstar Labs customers get set up and stay happy with the product every day.</p><h2>What you'll do</h2><ul><li>Run onboarding calls</li><li>Answer tickets</li></ul><h2>Requirements</h2><ul>${ITEMS.map((item) => `<li>${item}</li>`).join("")}</ul>`;
const ld = (extra: Record<string, unknown>) => `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Customer Support Specialist", hiringOrganization: { name: "Northstar Labs, Inc." }, description: SECTIONS, ...extra })}</script></head><body></body></html>`;

const SOURCES: Record<string, string> = {
  "board page (Ashby, Lever)": extractJobDescription(ld({ jobLocation: { address: { addressLocality: "Denver", addressRegion: "CO", addressCountry: "United States" } } }), "https://jobs.ashbyhq.com/northstar/1").markdown,
  "board JSON (Greenhouse, Workday, Oracle)": postingFromBoard({ url: "https://job-boards.greenhouse.io/northstar/jobs/2", title: "Customer Support Specialist | Northstar Careers", company: "Northstar Labs", location: "Denver, CO, United States", html: `<p>Employment type: Full time</p><p>Job ID: R-77</p>${SECTIONS}` }).extracted.markdown,
  "company page": extractJobDescription(`<html><head><title>Customer Support Specialist - Northstar Labs</title></head><body>${SECTIONS}</body></html>`, "https://careers.northstar.example/jobs/3").markdown,
  paste: cleanPosting(`Customer Support Specialist\nNorthstar Labs\n\nABOUT THE ROLE\nYou will help Northstar Labs customers get set up and stay happy with the product every day.\n\nREQUIREMENTS\n${ITEMS.map((item) => `- ${item}`).join("\n")}`, { title: "Customer Support Specialist", company: "Northstar Labs", location: null, source: "Pasted job description" }).markdown,
};

describe("the shared posting layout", () => {
  for (const [source, raw] of Object.entries(SOURCES)) {
    it(`lays out a ${source} the same way`, () => {
      const saved = postingTemplate(raw, { url: "Pasted job description" });
      const [title, blank, ...rest] = saved.split("\n");
      expect(title).toBe("# Customer Support Specialist");
      expect(blank).toBe("");
      const labels = rest.slice(0, rest.indexOf("")).map((line) => line.match(/^\*\*([^*]+):\*\*/)?.[1]);
      expect(labels.every(Boolean)).toBe(true);
      expect(labels).toEqual(POSTING_FACTS.filter((fact) => labels.includes(fact)));
      expect(labels.at(-1)).toBe("Source");
      expect(saved).toMatch(/\*\*Company:\*\* Northstar Labs\s/);
      expect(saved.split("\n").filter((line) => /^#\s/.test(line))).toHaveLength(1);
      expect(buildPostingRecord(saved).requiredItems).toEqual(buildPostingRecord(raw).requiredItems);
    });
  }

  it("leaves out facts the posting doesn't state and never repeats one in the body", () => {
    const saved = postingTemplate(SOURCES["board JSON (Greenhouse, Workday, Oracle)"]!);
    expect(saved).toContain("**Employment type:** Full-time");
    expect(saved).toContain("**Job ID:** R-77");
    expect(saved).not.toMatch(/\*\*Pay:\*\*/);
    expect(saved.match(/Job ID/g)).toHaveLength(1);
  });
});
