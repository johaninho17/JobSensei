// Issue #175: a company page that embeds a board's posting has that board's application form. Fictional sites only.
import { describe, expect, it } from "vitest";
import { embeddedFormSource, fetchApplicationForm, siteBoardName } from "../electron/application-questions";

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const html = (value: string) => new Response(value, { status: 200, headers: { "Content-Type": "text/html" } });
const greenhouseJob = { title: "Support Engineer", questions: [
  { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
  { label: "Will you now or in the future require visa sponsorship?", required: true, fields: [{ name: "question_1", type: "multi_value_single_select", values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }] },
] };

describe("forms on company pages", () => {
  it("names a site's board after its domain", () => {
    expect(siteBoardName("https://careers.northwind.com/jobs?gh_jid=1")).toBe("northwind");
    expect(siteBoardName("https://northwind.co.uk/careers?gh_jid=1")).toBe("northwind");
    expect(siteBoardName("not a link")).toBeNull();
  });

  it("follows a Greenhouse embed on the page", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.startsWith("https://northwind.example/careers")) return html('<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=northwindhq"></script>');
      if (url === "https://boards-api.greenhouse.io/v1/boards/northwindhq/jobs/555?questions=true") return json(greenhouseJob);
      return new Response("", { status: 404 });
    };
    expect(await embeddedFormSource("https://northwind.example/careers?gh_jid=555", fetcher)).toEqual({ board: "greenhouse", parts: ["northwindhq", "555"] });
    const fields = await fetchApplicationForm("https://northwind.example/careers?gh_jid=555", fetcher);
    expect(fields?.map((field) => field.label)).toEqual(["First Name", "Will you now or in the future require visa sponsorship?"]);
  });

  it("uses the site-named board only when Greenhouse has that exact job", async () => {
    const asked: string[] = [];
    const fetcher = (hasJob: boolean): typeof fetch => async (input) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith("https://northwind.example/")) return html("<h1>Support Engineer</h1><p>The posting, drawn by the site itself.</p>");
      if (hasJob && url.startsWith("https://boards-api.greenhouse.io/v1/boards/northwind/jobs/555")) return json(greenhouseJob);
      return new Response("", { status: 404 });
    };
    expect(await embeddedFormSource("https://northwind.example/jobs/search?gh_jid=555", fetcher(true))).toEqual({ board: "greenhouse", parts: ["northwind", "555"] });
    expect(await embeddedFormSource("https://northwind.example/jobs/search?gh_jid=555", fetcher(false))).toBeNull();
    expect(await embeddedFormSource("https://northwind.example/jobs/support-engineer", fetcher(true))).toBeNull();
    expect(asked.filter((url) => url.includes("boards-api")).length).toBe(2);
  });
});
