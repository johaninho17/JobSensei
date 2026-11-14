// Oracle Cloud career sites (#51): the company comes from the site name; a careers page linking one posting follows it.
import { describe, expect, it } from "vitest";
import { embeddedPostingUrl, oracleCompanyFromSiteName } from "../electron/jd-fetch";

describe("Oracle Cloud postings", () => {
  it("names the company from the career site's name", () => {
    expect(oracleCompanyFromSiteName("NSL Candidate Experience page")).toBe("NSL");
    expect(oracleCompanyFromSiteName("Northstar Labs Careers")).toBe("Northstar Labs");
    expect(oracleCompanyFromSiteName("External Career Site")).toBeNull();
    expect(oracleCompanyFromSiteName(null)).toBeNull();
  });

  it("follows a careers page whose only job link is an Oracle Cloud posting", () => {
    const link = "https://nsl.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12345";
    expect(embeddedPostingUrl(`<a href="${link}">Apply</a><a href="${link}">Apply now</a>`, "https://careers.northstar.example/jobs/12345")).toBe(link);
    expect(embeddedPostingUrl(`<a href="${link}">A</a><a href="${link.replace("12345", "678")}">B</a>`, "https://careers.northstar.example/jobs")).toBeNull();
  });
});
