// Issue #172: the pay period comes from the pay sentence itself, and a work setup the board or posting states beats
// sentence guesses. Fictional postings only.
import { describe, expect, it } from "vitest";
import { parsePay, parseWorkSetup } from "../electron/posting-record";
import { leverCompany, leverWorkplace, postingFromBoard } from "../electron/jd-fetch";

describe("pay period", () => {
  it("ignores period words in the benefits that follow the range", () => {
    const pay = parsePay("The United States base range for this position is $91,000-$128,000 plus equity. The benefits include six month paid parental leave and a monthly wellness allowance.");
    expect(pay).toMatchObject({ min: 91_000, max: 128_000, period: "year", text: "$91,000–$128,000/year" });
  });
  it("still reads a period stated with the amount", () => {
    expect(parsePay("Compensation: $6,000 - $7,500 per month, paid twice a month.")?.period).toBe("month");
    expect(parsePay("The hourly rate for this role is $32 to $40. Benefits start after one month.")?.period).toBe("hour");
  });
});

describe("work setup", () => {
  it("reads some in-person time plus working from home as hybrid", () => {
    expect(parseWorkSetup("We offer you the flexibility to work where you work best! There will be some in person meetings, but still allows for flexibility to work from home.")?.mode).toBe("hybrid");
  });
  it("lets a stated work setup beat a sentence that says otherwise", () => {
    expect(parseWorkSetup("**Work setup:** Hybrid\n\nYou will join our on-site team events every quarter.")?.mode).toBe("hybrid");
  });
  it("keeps fully remote roles remote", () => {
    expect(parseWorkSetup("This role is fully remote; you can work from home anywhere in the US, with an in-person offsite once a year.")?.mode).toBe("remote");
  });
});

describe("Lever's own fields", () => {
  it("maps workplaceType and finds the company in the page title", () => {
    expect(["hybrid", "remote", "onsite", "unspecified", undefined].map(leverWorkplace)).toEqual(["hybrid", "remote", "onsite", null, null]);
    expect(leverCompany("Northwind - Account Executive, Commercial", "Account Executive, Commercial", "northwind")).toBe("Northwind");
    expect(leverCompany(null, "Account Executive", "blue-harbor")).toBe("Blue Harbor");
  });
  it("puts the board's work setup in the saved posting", () => {
    const { extracted } = postingFromBoard({ url: "https://jobs.lever.co/northwind/00000000-0000-0000-0000-000000000000", title: "Account Executive", company: "Northwind", location: "New York, NY", html: "<p>Sell to growing companies. You'll meet customers on-site.</p>", workSetup: "hybrid" });
    expect(extracted.markdown).toMatch(/\*\*Work setup:\*\* Hybrid/);
  });
});
