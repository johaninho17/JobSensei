import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONNECTED, DEFAULT_AGY_BEHAVIOR, agyBehaviorSchema, bandFor, effectiveBehavior, jobSettingsScore, leniencyParts, settingScore } from "../src/shared/agy-behavior";
import { FIT_CLASSIFICATION_CREDIT, FIT_GATE } from "../src/shared/fit-credit";
import { candidateProfileSchema } from "../src/shared/schemas";

describe("Agy behavior settings and the settings score", () => {
  it("defaults to the rules the app follows today", () => {
    expect(DEFAULT_AGY_BEHAVIOR).toEqual({ framing: "framed", fit: { strong: FIT_CLASSIFICATION_CREDIT.strong_transferable, adjacent: FIT_CLASSIFICATION_CREDIT.adjacent_transferable, unclear: FIT_CLASSIFICATION_CREDIT.unclear, gate: FIT_GATE }, linesReworked: 4 });
    const parts = leniencyParts(DEFAULT_AGY_BEHAVIOR);
    expect(parts).toEqual({ framing: 6, "fit-credit": 5, "fit-gate": 5, "lines-reworked": 5 });
    expect(settingScore(DEFAULT_AGY_BEHAVIOR)).toMatchObject({ score: 53, band: "balanced" });
  });

  it("scores stricter and more lenient settings on 0–100 with a band", () => {
    const strict = agyBehaviorSchema.parse({ framing: "as-written", fit: { strong: 0, adjacent: 0, unclear: 0, gate: 4.5 }, linesReworked: 0 });
    expect(settingScore(strict)).toMatchObject({ score: 0, band: "strict" });
    const bold = agyBehaviorSchema.parse({ framing: "beyond", fit: { strong: 0.9, adjacent: 0.9, unclear: 0.7, gate: 2 }, linesReworked: 8 });
    expect(settingScore(bold)).toMatchObject({ score: 100, band: "bold" });
    expect([0, 24, 25, 49, 50, 74, 75, 100].map((score) => bandFor(score).label)).toEqual(["Strict", "Strict", "Careful", "Careful", "Balanced", "Balanced", "Bold", "Bold"]);
  });

  it("uses the profile's value only for settings connected to Agy", () => {
    const chosen = { framing: "beyond", fit: { gate: 2.5 }, linesReworked: 8 };
    const effective = effectiveBehavior(chosen);
    expect(effective.framing).toBe(CONNECTED.has("framing") ? "beyond" : "framed");
    expect(effective.fit.gate).toBe(CONNECTED.has("fit-gate") ? 2.5 : FIT_GATE);
    expect(effective.linesReworked).toBe(CONNECTED.has("lines-reworked") ? 8 : 4);
    expect(effectiveBehavior({ framing: "nonsense" })).toEqual(DEFAULT_AGY_BEHAVIOR);
    expect(effectiveBehavior(undefined)).toEqual(DEFAULT_AGY_BEHAVIOR);
  });

  it("gives every profile the settings with defaults, and old jobs the default score", () => {
    const demo = JSON.parse(readFileSync("examples/demo-workspace/profile/candidate.json", "utf8"));
    const profile = candidateProfileSchema.parse(demo);
    expect(profile.preferences.agy).toEqual(DEFAULT_AGY_BEHAVIOR);
    expect(jobSettingsScore(null)).toMatchObject({ score: 53, band: "balanced" });
    expect(jobSettingsScore(settingScore(agyBehaviorSchema.parse({ framing: "as-written" })))).toMatchObject({ score: 38, band: "careful" });
  });
});

describe("fit settings (#37)", () => {
  it("scores each job with the credit and gate stamped on its snapshot", async () => {
    const { calculateFitScore, fitSettingsOf, gateStatusFor } = await import("../electron/fit-scoring");
    const rows = [
      { requirement: "req:1 Customer onboarding", category: "core", classification: "strong_transferable", weight: 61.54, evidence: "", reason: "" },
      { requirement: "req:2 SQL", category: "technical", classification: "adjacent_transferable", weight: 38.46, evidence: "", reason: "" },
    ] as never;
    const today = calculateFitScore(rows);
    const lenient = calculateFitScore(rows, { strong: 0.9, adjacent: 0.8, unclear: 0.1, gate: 2.5 });
    expect(lenient.score).toBeGreaterThan(today.score);
    expect(fitSettingsOf(null)).toEqual(DEFAULT_AGY_BEHAVIOR.fit);
    const stamped = settingScore(agyBehaviorSchema.parse({ fit: { gate: 2.5 } }));
    expect(fitSettingsOf({ settingsScore: stamped }).gate).toBe(2.5);
    expect(gateStatusFor({ ...today, score: 3, gateScore: 3 } as never)).toContain("below threshold");
    expect(gateStatusFor({ ...today, score: 3, gateScore: 3 } as never, 2.5)).toBe("accepted");
  });

  it("reads every connected setting from the profile", () => {
    expect([...CONNECTED].sort()).toEqual(["fit-credit", "fit-gate", "framing", "lines-reworked"]);
    const effective = effectiveBehavior({ framing: "beyond", fit: { strong: 0.9, gate: 2.5 }, linesReworked: 8 });
    expect(effective.fit).toMatchObject({ strong: 0.9, gate: 2.5 });
    expect(effective.framing).toBe("beyond");
    expect(effective.linesReworked).toBe(8);
  });
});

describe("resume lines reworked (#38)", () => {
  it("tells Agy how many current-role bullets to rewrite, from the user's setting", async () => {
    const { bulletPlanLine } = await import("../electron/evidence-snapshot");
    const plan = (rewriteUpTo: number) => ({ employerTargets: [{ employer: "Northstar Labs", baseBullets: 6, maxBullets: 6, rewriteUpTo }, { employer: "Acme Corp", baseBullets: 3, maxBullets: 3, rewriteUpTo: 0 }] }) as never;
    expect(bulletPlanLine(plan(4))).toContain("rewrite 3–4 of them");
    expect(bulletPlanLine(plan(6))).toContain("rewrite up to 6 of them");
    expect(bulletPlanLine(plan(2))).toContain("rewrite up to 2 of them");
    const none = bulletPlanLine(plan(0));
    expect(none).toContain("keep every Northstar Labs bullet as written");
    expect(none).toContain("Acme Corp: leave out of the bundle");
  });
});

describe("framing dial (#36)", () => {
  it("gives Agy one framing line per stop, each with the same floor", async () => {
    const { FRAMING_FLOOR, FRAMING_STOPS, framingInstruction } = await import("../src/shared/agy-behavior");
    for (const stop of FRAMING_STOPS) {
      const line = framingInstruction(stop);
      expect(line).toMatch(/^Framing \(the candidate's setting/);
      expect(line).toContain(`never invent ${FRAMING_FLOOR}`);
    }
    expect(framingInstruction("framed")).toContain("same confidence as the base resume");
    expect(framingInstruction("as-written")).toContain("no stronger verb, scope, or ownership");
    expect(framingInstruction("beyond")).toContain("the app marks every such line");
    expect(CONNECTED.has("framing")).toBe(true);
  });

  it("warns about lines past the setting, and lists lines beyond the evidence at the top stop", async () => {
    const { framingIssues } = await import("../electron/application-validation");
    const lines = [
      { text: "Onboarded new customers to the analytics product", artifact: "resume", level: 0, reason: "As its evidence says." },
      { text: "Guided customers through data setup and first reports", artifact: "resume", level: 1, reason: "Reworded from its evidence." },
      { text: "Led enterprise-wide onboarding for every new account", artifact: "resume", level: 2, reason: "Stronger than its evidence: led, enterprise-wide, every." },
      { text: "Owned the Salesforce rollout", artifact: "resume", level: 3, reason: "Not supported by its cited evidence." },
    ] as never;
    expect((framingIssues(lines, "framed") as Array<{ code: string }>).map((item) => item.code)).toEqual(["LINE_PAST_FRAMING_SETTING"]);
    expect(framingIssues(lines, "reworded")).toHaveLength(2);
    expect(framingIssues(lines, "as-written")).toHaveLength(3);
    const beyond = framingIssues(lines, "beyond") as Array<{ code: string; severity: string; message: string }>;
    expect(beyond).toHaveLength(1);
    expect(beyond[0]).toMatchObject({ code: "LINES_BEYOND_EVIDENCE", severity: "warning" });
    expect(beyond[0]!.message).toContain("Owned the Salesforce rollout");
  });

  it("puts the setting's line in the run instructions and points the other copies to it", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("electron/evidence-snapshot.ts", "utf8")).toContain('framingInstruction(snapshot.settingsScore?.behavior.framing ?? "framed")');
    expect(readFileSync("AGENTS.md", "utf8")).toContain("follow the `Framing` line in the run's instructions");
    expect(readFileSync(".agents/skills/jobsensei-application-writer/SKILL.md", "utf8")).toContain("as the run's `Framing` line says");
  });
});
