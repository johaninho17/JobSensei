// #116: an Ashby posting whose board API leaves out the date or pay gets them from the page's embedded data.
// Fictional company only.
import { describe, expect, it } from "vitest";
import { buildPostingRecord } from "../electron/posting-record";
import { extractJobDescription, pagePosted, postingFromBoard } from "../electron/jd-fetch";

const ASHBY_PAGE = `<html><head><title>Solutions Engineer @ Northstar Labs</title></head><body>
<div id="root"><h1>Solutions Engineer</h1><p>Northstar Labs helps teams run their integrations. You will own customer onboarding and keep imports running across a growing set of partner systems, working closely with support and engineering every day.</p></div>
<script>window.__appData = {"organization":{"name":"Northstar Labs"},"posting":{"title":"Solutions Engineer","publishedDate":"2026-11-02","scrapeableCompensationSalarySummary":"$120K \\u2013 $150K"}};</script>
</body></html>`;

describe("Ashby embedded data (#116)", () => {
  it("reads the posted date from structured data first, then Ashby's app data", () => {
    expect(pagePosted({ datePosted: "2026-10-30T08:00:00Z" }, ASHBY_PAGE)).toBe("2026-10-30");
    expect(pagePosted(null, ASHBY_PAGE)).toBe("2026-11-02");
    expect(pagePosted(null, "<html><body>No dates here</body></html>")).toBeNull();
  });

  it("an Ashby page without API date or pay gets both into the posting record", () => {
    const extracted = extractJobDescription(ASHBY_PAGE, "https://jobs.ashbyhq.com/northstar/0b8c2f1e-1111-4222-8333-944455556666");
    expect(extracted.markdown).toContain("**Posted:** 2026-11-02");
    expect(extracted.markdown).toContain("**Compensation:** $120K – $150K");
    const record = buildPostingRecord(extracted.markdown);
    expect(record.postedAt).toBe("2026-11-02");
    expect(record.pay?.text).toContain("$120K");
  });

  it("a posting built from board data keeps the board's date", () => {
    const { extracted } = postingFromBoard({ url: "https://jobs.ashbyhq.com/northstar/x", title: "Solutions Engineer", company: "Northstar Labs", location: "Remote", html: "<p>Own onboarding for partner systems and keep imports running with support and engineering.</p>", posted: "2026-11-03T10:00:00.000Z" });
    expect(buildPostingRecord(extracted.markdown).postedAt).toBe("2026-11-03");
  });
});
