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
