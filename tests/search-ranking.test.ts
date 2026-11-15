// #39: Job Search ranking weights live in Agy's Behavior settings; the defaults keep the old order.
import { describe, expect, it } from "vitest";
import { DEFAULT_AGY_BEHAVIOR, effectiveBehavior, settingScore } from "../src/shared/agy-behavior";
import { DEFAULT_RANKING, rankInbox, rankReason, yearlyPay, type InboxItem } from "../src/shared/job-search";

const now = Date.parse("2026-11-15T12:00:00.000Z");
const item = (id: string, score: number, patch: Partial<InboxItem> = {}): InboxItem => ({
  id: `find-${id}`, url: `https://jobs.example.com/${id}`, title: "Solutions Engineer", company: id, location: null, board: null,
  postedAt: "2026-10-20", foundAt: "2026-11-15T08:00:00.000Z", runId: "r", status: "new", pay: null, workSetup: null, level: null,
  fit: { score, why: "", covered: 0, total: 0, gaps: [], blockers: [], flags: [] }, jobId: null, queuedAt: null, autoQueued: false, watched: false, agyFit: null, likeInterviewed: null, ...patch,
});
const order = (items: InboxItem[], weights = DEFAULT_RANKING) => rankInbox(items, "fit", weights, now).map((entry) => entry.company);

describe("Job Search ranking from Behavior settings (#39)", () => {
  const items = [
    item("steady", 4.0),
    item("fresh", 3.8, { postedAt: "2026-11-15" }),
    item("paid", 3.7, { pay: "$220K–$260K base" }),
    item("familiar", 3.85, { likeInterviewed: "Like your Northstar interview" }),
  ];

  it("defaults rank exactly as before: fit, plus a quarter point for jobs like interviewed ones", () => {
    expect(DEFAULT_RANKING).toEqual({ fit: 1, freshness: 0, pay: 0, likeInterviewed: 0.25 });
    expect(order(items)).toEqual(["familiar", "steady", "fresh", "paid"]);
  });

  it("moving a slider changes the order", () => {
    expect(order(items, { ...DEFAULT_RANKING, freshness: 1 })[0]).toBe("fresh");
    expect(order(items, { ...DEFAULT_RANKING, pay: 1 })[0]).toBe("paid");
    expect(order(items, { ...DEFAULT_RANKING, likeInterviewed: 0 })[0]).toBe("steady");
  });

  it("each match says why it ranks there", () => {
    expect(rankReason(items[3]!, DEFAULT_RANKING, now)).toBe("fit 3.9 · Like your Northstar interview +0.25");
    expect(rankReason(items[1]!, { ...DEFAULT_RANKING, freshness: 1 }, now)).toBe("fit 3.8 · newly posted +0.98");
    expect(yearlyPay("$55/hr")).toBe(114400);
    expect(yearlyPay("$120K - $150K")).toBe(150000);
  });

  it("the weights are saved with Agy's behavior but never move the settings score", () => {
    const saved = effectiveBehavior({ search: { fit: 1, freshness: 0.6, pay: 0.4, likeInterviewed: 0 } });
    expect(saved.search).toEqual({ fit: 1, freshness: 0.6, pay: 0.4, likeInterviewed: 0 });
    expect(settingScore(saved).score).toBe(settingScore(DEFAULT_AGY_BEHAVIOR).score);
    expect(effectiveBehavior({}).search).toEqual(DEFAULT_RANKING);
  });
});
