import { z } from "zod";
import { FIT_CLASSIFICATION_CREDIT, FIT_GATE } from "./fit-credit";

/**
 * How Agy behaves when it drafts, and one number for how lenient that is (owner of both). Each setting has a
 * default equal to the rule the app follows today, and maps to 0 (strict) … 10 (lenient); the settings score is
 * their average on 0–100. The snapshot stamps the score on every run, so each job keeps the score it was made under.
 *
 * A setting is read from the user's profile only once it is connected to Agy (`CONNECTED`). Until then the app's
 * fixed rule is used and shown, so the page never offers a control that changes nothing.
 */

export const FRAMING_STOPS = ["as-written", "reworded", "framed", "beyond"] as const;
export type FramingStop = (typeof FRAMING_STOPS)[number];
export const FRAMING_LABELS: Record<FramingStop, string> = {
  "as-written": "As written in your files",
  reworded: "Reworded, same strength",
  framed: "Framed at its strongest",
  beyond: "Beyond the evidence, with warnings",
};

/** The furthest stretch level (electron/stretch-score.ts: 0 as evidence, 1 reworded, 2 framed stronger, 3 unsupported)
 * each framing stop allows without a warning. */
export const FRAMING_MAX_LEVEL: Record<FramingStop, 0 | 1 | 2 | 3> = { "as-written": 0, reworded: 1, framed: 2, beyond: 3 };

/** What no framing setting ever allows: these stay exactly as the evidence states. */
export const FRAMING_FLOOR = "an employer, job title, degree, credential, date, number, or result";

/**
 * The framing rule Agy gets (owner of this rule; AGENTS.md and the skills point here). One sentence per stop.
 */
export function framingInstruction(stop: FramingStop): string {
  const floor = `At every setting, never invent ${FRAMING_FLOOR}: those stay exactly as the cited rows state.`;
  switch (stop) {
    case "as-written": return `Framing (the candidate's setting: as written): keep rewritten bullets close to the cited rows' own wording; reorder and trim for this job, but use no stronger verb, scope, or ownership than the rows. ${floor}`;
    case "reworded": return `Framing (the candidate's setting: reworded): reword rewritten bullets for this job at the same strength as the cited rows; plainer or more relevant words are fine, a stronger verb, scope, or ownership is not. ${floor}`;
    case "beyond": return `Framing (the candidate's setting: beyond the evidence): you may present adjacent or partial experience as directly relevant and use stronger ownership and scope words than the rows state; the app marks every such line so the candidate can keep or revert it. ${floor}`;
    default: return `Framing (the candidate's setting: framed at its strongest): frame rewritten bullets with the same confidence as the base resume: describe the kind of work clearly and strongly, but every rewritten claim must trace to evidenceRows. ${floor}`;
  }
}

export const agyBehaviorSchema = z.object({
  /** How far a tailored line may reach past its evidence (#36). */
  framing: z.enum(FRAMING_STOPS).default("framed"),
  /** Fit credit per match level and the score a job needs to be worth applying to (#37). */
  fit: z.object({
    strong: z.number().min(0).max(1).default(FIT_CLASSIFICATION_CREDIT.strong_transferable),
    adjacent: z.number().min(0).max(1).default(FIT_CLASSIFICATION_CREDIT.adjacent_transferable),
    unclear: z.number().min(0).max(1).default(FIT_CLASSIFICATION_CREDIT.unclear),
    gate: z.number().min(1).max(5).default(FIT_GATE),
    /** Each requirement category's share of the fit score; they add up to 100 (#92). Not part of the settings score. */
    weights: z.object({
      core: z.number().int().min(1).max(100).default(40),
      technical: z.number().int().min(0).max(100).default(25),
      scope: z.number().int().min(0).max(100).default(15),
      outcomes: z.number().int().min(0).max(100).default(10),
      domain: z.number().int().min(0).max(100).default(5),
      learning: z.number().int().min(0).max(100).default(5),
    }).prefault({}).refine((weights) => Object.values(weights).reduce((sum, value) => sum + value, 0) === 100, { message: "The category weights must add up to 100." }),
  }).prefault({}),
  /** Most current-role bullets reworked per resume (#38). */
  linesReworked: z.number().int().min(0).max(12).default(4),
});
export type AgyBehavior = z.infer<typeof agyBehaviorSchema>;
export const DEFAULT_AGY_BEHAVIOR: AgyBehavior = agyBehaviorSchema.parse({});

export type BehaviorSetting = "framing" | "fit-credit" | "fit-gate" | "lines-reworked";
/** Settings whose profile value already reaches Agy. Each issue that connects one adds it here. */
export const CONNECTED: ReadonlySet<BehaviorSetting> = new Set<BehaviorSetting>(["framing", "fit-credit", "fit-gate", "lines-reworked"]);

/** What the app does now: the profile's value for connected settings, the fixed rule for the rest. */
export function effectiveBehavior(saved?: unknown): AgyBehavior {
  const parsed = agyBehaviorSchema.safeParse(saved ?? {});
  const chosen = parsed.success ? parsed.data : DEFAULT_AGY_BEHAVIOR;
  return {
    framing: CONNECTED.has("framing") ? chosen.framing : DEFAULT_AGY_BEHAVIOR.framing,
    fit: {
      ...(CONNECTED.has("fit-credit") ? { strong: chosen.fit.strong, adjacent: chosen.fit.adjacent, unclear: chosen.fit.unclear } : { strong: DEFAULT_AGY_BEHAVIOR.fit.strong, adjacent: DEFAULT_AGY_BEHAVIOR.fit.adjacent, unclear: DEFAULT_AGY_BEHAVIOR.fit.unclear }),
      gate: CONNECTED.has("fit-gate") ? chosen.fit.gate : DEFAULT_AGY_BEHAVIOR.fit.gate,
      weights: chosen.fit.weights,
    },
    linesReworked: CONNECTED.has("lines-reworked") ? chosen.linesReworked : DEFAULT_AGY_BEHAVIOR.linesReworked,
  };
}

const clamp = (value: number) => Math.min(10, Math.max(0, Math.round(value * 10) / 10));
const FRAMING_LENIENCY: Record<FramingStop, number> = { "as-written": 0, reworded: 3, framed: 6, beyond: 10 };
const DEFAULT_CREDIT = (DEFAULT_AGY_BEHAVIOR.fit.strong + DEFAULT_AGY_BEHAVIOR.fit.adjacent + DEFAULT_AGY_BEHAVIOR.fit.unclear) / 3;

/** Each setting on 0 (strict) … 10 (lenient). Today's rules sit near the middle. */
export function leniencyParts(behavior: AgyBehavior): Record<BehaviorSetting, number> {
  const credit = (behavior.fit.strong + behavior.fit.adjacent + behavior.fit.unclear) / 3;
  return {
    framing: FRAMING_LENIENCY[behavior.framing],
    // Twice today's average partial credit is the most lenient; no partial credit is the strictest.
    "fit-credit": clamp((credit / DEFAULT_CREDIT) * 5),
    // Today's gate (3.2) is 5; each point lower is 5 more lenient.
    "fit-gate": clamp(5 + (DEFAULT_AGY_BEHAVIOR.fit.gate - behavior.fit.gate) * 5),
    // Reworking none is 0; today's 3–4 lines is 5; 8 or more is 10.
    "lines-reworked": clamp(behavior.linesReworked * 1.25),
  };
}

export const SETTINGS_BANDS = [
  { band: "strict", label: "Strict", min: 0 },
  { band: "careful", label: "Careful", min: 25 },
  { band: "balanced", label: "Balanced", min: 50 },
  { band: "bold", label: "Bold", min: 75 },
] as const;
export type SettingsBand = (typeof SETTINGS_BANDS)[number]["band"];

export const settingsScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  band: z.enum(["strict", "careful", "balanced", "bold"]),
  parts: z.record(z.string(), z.number()),
  behavior: agyBehaviorSchema,
});
export type SettingsScore = z.infer<typeof settingsScoreSchema>;

export function bandFor(score: number): (typeof SETTINGS_BANDS)[number] {
  return [...SETTINGS_BANDS].reverse().find((band) => score >= band.min) ?? SETTINGS_BANDS[0];
}

/** One number (0–100) for how lenient Agy's settings are, with its band. */
export function settingScore(behavior: AgyBehavior): SettingsScore {
  const parts = leniencyParts(behavior);
  const values = Object.values(parts);
  const score = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10);
  return { score, band: bandFor(score).band, parts, behavior };
}

/** The score a job was made under; jobs from before the score existed were made under today's rules. */
export function jobSettingsScore(stamped: unknown): SettingsScore {
  const parsed = settingsScoreSchema.safeParse(stamped);
  return parsed.success ? parsed.data : settingScore(DEFAULT_AGY_BEHAVIOR);
}

export function settingsScoreLabel(score: SettingsScore): string {
  return `${score.score} ${bandFor(score.score).label}`;
}
