import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrief, decideFinding, readAnalysis, runAnalysis } from "../electron/data-analysis";
import { checkFindings, findingKey } from "../src/shared/data-analysis";

// Fictional candidate only.
const NOW = new Date("2026-11-26T12:00:00Z");
const HEADER = "| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |\n| --- | --- | --- | --- | --- | --- | --- | --- |";
const NORTHWIND = [
  "# Evidence: Northwind work",
  "",
  "- years: 2019-2021",
  "",
  HEADER,
  "| context:northwind:reports | 2021 | Northwind Support | Built weekly support reports for 3 team leads | Internal tool | notes.md | high | eligible |",
  "| context:northwind:onboarding | 2020 | Northwind Onboarding | Ran onboarding calls for new customers | Customer-facing | notes.md | high | eligible |",
  "| context:northwind:onboarding-dup | 2020 | Northwind Onboarding | Ran onboarding calls for new customers | Customer-facing | notes.md | high | eligible |",
  "",
].join("\n");
const SCHOOL = [
  "# Evidence: School",
  "",
  HEADER,
  "| context:school:onboarding | 2018 | Northwind Onboarding | Shadowed onboarding calls as an intern | Internship | notes.md | high | foundation only |",
  "",
].join("\n");

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-analysis-"));
  await mkdir(join(root, ".sensei"), { recursive: true });
  await mkdir(join(root, "context", "structured"), { recursive: true });
  await writeFile(join(root, "context/structured/northwind.md"), NORTHWIND);
  await writeFile(join(root, "context/structured/school.md"), SCHOOL);
  return root;
}

const records = { "context/structured/northwind.md": new Map([["context:northwind:reports", "| context:northwind:reports | 2021 | Northwind Support | Built weekly support reports for 3 team leads |"]]) };
const texts = { "context/structured/northwind.md": NORTHWIND };
const finding = (patch: Record<string, unknown> = {}, fix: Record<string, unknown> = {}) => ({
  id: "fnd-1", kind: "stale", subject: "Northwind reports", file: "context/structured/northwind.md", rowId: "context:northwind:reports",
  issue: "The reports row doesn't say what the reports were built with.",
  basis: [{ file: "context/structured/northwind.md", quote: "Built weekly support reports for 3 team leads" }],
  fix: { action: "update", row: { evidenceId: "context:northwind:reports", year: "2021", project: "Northwind Support", claim: "Built weekly support reports for 3 team leads", scope: "Internal tool", publicUse: "eligible" }, question: null, ...fix },
  ...patch,
});

describe("data analysis checks (#200)", () => {
  const check = (items: unknown[], refused = new Set<string>()) => checkFindings(items, { texts, records, refused });

  it("keeps a finding that follows every rule", () => {
    expect(check([finding()]).kept.map((kept) => kept.id)).toEqual(["fnd-1"]);
  });

  it("drops a quote that isn't in the file", () => {
    expect(check([finding({ basis: [{ file: "context/structured/northwind.md", quote: "Led a team of twelve" }] })]).dropped[0]?.reason).toMatch(/quote not found/);
  });

  it("lets a thin finding only ask", () => {
    expect(check([finding({ kind: "thin" })]).dropped[0]?.reason).toMatch(/only ask/);
    expect(check([finding({ kind: "thin", rowId: null }, { action: "ask", row: null, question: "Did you use SQL for those reports?" })]).kept).toHaveLength(1);
  });

  it("drops an update to a row that isn't there and a file that isn't a career record", () => {
    expect(check([finding({ rowId: "context:northwind:missing" })]).dropped[0]?.reason).toMatch(/not in/);
    expect(check([finding({ file: "profile/candidate_profile.json" })]).dropped[0]?.reason).toMatch(/not a career record/);
  });

  it("drops a number the candidate's text doesn't hold", () => {
    const fix = { row: { evidenceId: "context:northwind:reports", year: "2021", project: "Northwind Support", claim: "Built weekly reports for 3 team leads, saving 40% of their time", scope: "", publicUse: "eligible" } };
    expect(check([finding({}, fix)]).dropped[0]?.reason).toMatch(/number 40%/);
  });

  it("drops a finding the user refused before, and a second copy of one", () => {
    expect(check([finding()], new Set([findingKey(finding() as never)])).dropped[0]?.reason).toBe("refused before");
    expect(check([finding(), finding({ id: "fnd-2" })]).dropped[0]?.reason).toBe("same as another finding");
  });
});

describe("data analysis run and choices (#200)", () => {
  it("finds clashing years and duplicate claims itself, before Agy", async () => {
    const root = await workspace();
    const { brief } = await buildBrief(root, { jobs: [], profile: null, now: NOW });
    expect(brief.conflicts.map((conflict) => conflict.project)).toEqual(["Northwind Onboarding"]);
    expect(brief.duplicates[0]?.rows.map((row) => row.rowId)).toEqual(["context:northwind:onboarding", "context:northwind:onboarding-dup"]);
    expect(brief.files.map((file) => file.path)).toEqual(["context/structured/northwind.md", "context/structured/school.md"]);
  });

  it("stores only checked findings, and each choice does what it says", async () => {
    const root = await workspace();
    const reply = { findings: [
      finding({ id: "fnd-1", kind: "duplicate", subject: "Onboarding calls", rowId: "context:northwind:onboarding-dup", basis: [{ file: "context/structured/northwind.md", quote: "Ran onboarding calls for new customers" }] },
        { action: "remove", row: { evidenceId: "context:northwind:onboarding-dup", year: "2020", project: "Northwind Onboarding", claim: "Ran onboarding calls for new customers", scope: "Customer-facing", publicUse: "eligible" } }),
      finding({ id: "fnd-2", kind: "thin", subject: "SQL", rowId: null }, { action: "ask", row: null, question: "Did you write SQL for the weekly reports?" }),
      finding({ id: "fnd-3", subject: "Northwind years", rowId: null, basis: [{ file: "context/structured/northwind.md", quote: "years: 2019-2021" }] }, { action: "add", row: { evidenceId: "", year: "2019", project: "Northwind", claim: "Joined Northwind", scope: "", publicUse: "eligible" } }),
      finding({ id: "fnd-4", basis: [{ file: "context/structured/northwind.md", quote: "Invented quote here" }] }),
    ], skipped: [] };
    const runner = async (prompt: string) => {
      expect(prompt).toContain(".agents/workflows/jobsensei-data-analysis.md");
      return { response: JSON.stringify(reply), conversationId: null };
    };
    const view = await runAnalysis(root, runner, { jobs: [], profile: null, now: NOW });
    expect(view.findings.map((item) => item.subject)).toEqual(["Onboarding calls", "SQL", "Northwind years"]);
    expect(view.dropped).toEqual([{ id: "fnd-4", reason: "quote not found in context/structured/northwind.md" }]);

    const [remove, ask, add] = view.findings;
    expect(await decideFinding(root, remove!.id, "accept", null, NOW)).toEqual({ changed: "context/structured/northwind.md" });
    expect(await readFile(join(root, "context/structured/northwind.md"), "utf8")).not.toContain("onboarding-dup");

    await decideFinding(root, ask!.id, "ask", null, NOW);
    const questions = JSON.parse(await readFile(join(root, ".sensei/today-questions.json"), "utf8")) as { questions: Array<{ kind: string; text: string }> };
    expect(questions.questions).toEqual([expect.objectContaining({ kind: "skill", text: "Did you write SQL for the weekly reports?" })]);

    await decideFinding(root, add!.id, "edit", { claim: "Joined Northwind support in 2019" }, NOW);
    expect(await readFile(join(root, "context/structured/northwind.md"), "utf8")).toContain("Joined Northwind support in 2019");

    // A refusal is remembered: the next run drops the same finding.
    const again = await runAnalysis(root, async () => ({ response: JSON.stringify({ findings: [finding({ id: "fnd-9" })], skipped: [] }), conversationId: null }), { jobs: [], profile: null, now: NOW });
    const open = again.findings.filter((item) => item.status === "open");
    expect(open).toHaveLength(1);
    await decideFinding(root, open[0]!.id, "refuse", null, NOW);
    const third = await runAnalysis(root, async () => ({ response: JSON.stringify({ findings: [finding({ id: "fnd-9" })], skipped: [] }), conversationId: null }), { jobs: [], profile: null, now: NOW });
    expect(third.findings.filter((item) => item.status === "open")).toEqual([]);
    expect(third.dropped[0]?.reason).toBe("refused before");
    expect((await readAnalysis(root)).findings.map((item) => item.status)).toEqual(["accepted", "asked", "accepted", "refused"]);
  });
});
