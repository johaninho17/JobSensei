// Today in Bento (ledger U77, #126): one "Do this next" step picked in a fixed order, and the same Today sections and
// actions as before, now in cards. Fictional jobs only.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { TodayData } from "../src/shared/today";
import { pickNextStep } from "../src/shared/today-next";

type Input = Pick<TodayData, "due" | "questions" | "search">;
const empty = (): Input => ({ due: { followUps: [], interviewsThisWeek: [], closedPostings: [], stale: [] }, questions: [], search: { lastRun: null, newCount: 0, top: [] } });
const match = (id: string, score: number, agy?: number) => ({ id, title: `Role ${id}`, company: "Northstar Labs", location: null, fit: { score }, agyFit: agy === undefined ? null : { score: agy } }) as unknown as Input["search"]["top"][number];
const question = { id: "q1", text: "Where did you use SQL?" } as unknown as Input["questions"][number];

describe("Do this next (#126)", () => {
  it("is nothing when there's nothing to do", () => {
    expect(pickNextStep(empty())).toBeNull();
  });

  it("goes interview → follow-up → closed posting → question → best match", () => {
    const input = empty();
    input.search.top = [match("a", 3.1), match("b", 3.0, 4.6)];
    expect(pickNextStep(input)).toMatchObject({ kind: "match", matchId: "b", score: 4.6 });
    input.questions = [question];
    expect(pickNextStep(input)).toMatchObject({ kind: "question", questionId: "q1" });
    input.due.closedPostings = [{ jobId: "job3", company: "Northstar Labs", title: "Analyst", since: "2026-11-20" } as Input["due"]["closedPostings"][number]];
    expect(pickNextStep(input)).toMatchObject({ kind: "closed", jobId: "job3", label: "Northstar Labs, Analyst" });
    input.due.followUps = [{ id: "job1", label: "Northstar Labs, Analyst", days: 1 }, { id: "job2", label: "Harbor Co, Lead", days: 4 }];
    expect(pickNextStep(input)).toMatchObject({ kind: "follow-up", jobId: "job2", days: 4 });
    input.due.interviewsThisWeek = [{ id: "job5", label: "B", date: "2026-11-27", round: "hiring_manager" }, { id: "job4", label: "A", date: "2026-11-25", round: "recruiter" }];
    expect(pickNextStep(input)).toMatchObject({ kind: "interview", jobId: "job4", date: "2026-11-25" });
  });
});

describe("Today layout (#126)", () => {
  it("puts Today in a bento page with one brass hero, KPIs, and every section it had", async () => {
    const view = await readFile("src/renderer/TodayView.tsx", "utf8");
    expect(view).toContain('<section className="today bento-page">');
    expect(view.match(/tone="hero"/g)).toHaveLength(1);
    expect(view).toContain("pickNextStep(today)");
    for (const kpi of ["FEATURES.interviews && <Kpi", "FEATURES.jobSearch && <Kpi", "FEATURES.tune && tuneFiles !== null && <Kpi"]) expect(view).toContain(kpi);
    for (const id of ["today-due", "today-search", "today-questions", "today-answers", "today-insights", "today-activity"]) expect(view).toContain(`<Section id="${id}"`);
    for (const action of ["closePosting(", "keepPosting(", 'matchAction(item.id, "draft")', 'matchAction(item.id, "save")', "<QuestionCard"]) expect(view).toContain(action);
    expect(view).toContain("<FitRing rating={score}");
    expect(view).not.toContain("Ask 3 more");
  });

  it("the Tune tile opens Career context on its Tune tab", async () => {
    const app = await readFile("src/renderer/App.tsx", "utf8");
    expect(app).toContain('onOpenTune={() => void showPage("context-home").then(() => setContextStart("tune"))}');
    expect(app).toContain("startView={contextStart}");
    expect(await readFile("src/renderer/SetupAndContext.tsx", "utf8")).toContain("if (startView && tune) setView(startView);");
  });

  it("no other page uses the bento", async () => {
    const { readdirSync } = await import("node:fs");
    const users = readdirSync("src/renderer").filter((name) => name.endsWith(".tsx") && !["TodayView.tsx", "BentoPrimitives.tsx"].includes(name));
    for (const name of users) expect(await readFile(`src/renderer/${name}`, "utf8"), name).not.toMatch(/bento|BentoCard|<Kpi|<FitRing/);
  });
});
