// Tune suggestions as data (ledger U76, #107). Agy writes `.sensei/tune/<area>.json`; the app checks it, ranks the
// suggestions, shows at most five, applies only what the user picks, banks the rest, and never suggests a declined one
// again. There is no delete: a removal is a `replace` (better version) or an `archive` (kept in history), per U37.
import { z } from "zod";

export const TUNE_DIR = ".sensei/tune";
export const TUNE_BANK_FILE = `${TUNE_DIR}/bank.json`;
export const TUNE_DECLINED_FILE = `${TUNE_DIR}/declined.json`;
export const TUNE_HISTORY_FILE = `${TUNE_DIR}/history.json`;
export const tuneSuggestionsFile = (area: TuneArea) => `${TUNE_DIR}/${area}.json`;

/** How many suggestions one Tune shows; the rest wait in the bank. */
export const TUNE_SHOWN = 5;

export const TUNE_AREAS = ["interviews", "career", "story-bank", "voice"] as const;
export type TuneArea = typeof TUNE_AREAS[number];
export const TUNE_OPERATIONS = ["add", "enrich", "replace", "archive"] as const;
export type TuneOperation = typeof TUNE_OPERATIONS[number];

const line = z.string().transform((value) => value.replace(/\s+/g, " ").trim()).pipe(z.string().min(1));
/** Multi-line text (a story bank section, a voice rule with examples): trimmed, line breaks kept. */
const block = z.string().transform((value) => value.replace(/\r\n/g, "\n").trim()).pipe(z.string().min(1));
const workspacePath = line.refine((value) => !value.startsWith("/") && !/^[a-z]:/i.test(value) && !value.split("/").includes(".."), { message: "a path inside the workspace" });
const score = z.number().int().min(1).max(5);

/** One suggestion as Agy writes it. */
export const tuneSuggestionInputSchema = z.object({
  operation: z.enum(TUNE_OPERATIONS),
  /** The content file it changes, from the workspace (e.g. `profile/story_bank.md`). */
  file: workspacePath,
  /** The section heading it goes under (for `add`) or sits under. */
  section: line,
  /** The item it changes: a story ID (`S3`), a table row's first cell, or a bullet's first words. Not for `add`. */
  target: line.optional(),
  /** The new text. Required except for `archive`. */
  text: block.optional(),
  reason: line,
  /** The file the suggestion comes from (a recording, a career file, a letter). */
  source: workspacePath,
  urgency: score,
  impact: score,
}).strict().superRefine((value, ctx) => {
  if (value.operation !== "add" && !value.target) ctx.addIssue({ code: "custom", path: ["target"], message: `"${value.operation}" needs the item it changes` });
  if (value.operation !== "archive" && !value.text) ctx.addIssue({ code: "custom", path: ["text"], message: `"${value.operation}" needs the new text` });
  if (value.operation === "archive" && value.text) ctx.addIssue({ code: "custom", path: ["text"], message: "\"archive\" keeps the old text in history and takes no new text" });
});
export type TuneSuggestionInput = z.input<typeof tuneSuggestionInputSchema>;

/** The file Agy writes for one area. Unknown keys (e.g. a "delete" field) are rejected, not ignored. */
export const tuneSuggestionsFileSchema = z.object({
  schemaVersion: z.literal(1),
  area: z.enum(TUNE_AREAS),
  suggestions: z.array(tuneSuggestionInputSchema).max(40),
}).strict();

/** A checked suggestion with the app's stable ID and the source's hash when it was made. */
export const tuneSuggestionSchema = z.object({
  id: z.string().regex(/^t-[0-9a-f]{12}$/),
  area: z.enum(TUNE_AREAS),
  operation: z.enum(TUNE_OPERATIONS),
  file: workspacePath,
  section: line,
  target: line.optional(),
  text: block.optional(),
  reason: line,
  source: workspacePath,
  sourceHash: z.string().min(1),
  urgency: score,
  impact: score,
  createdAt: z.string(),
});
export type TuneSuggestion = z.infer<typeof tuneSuggestionSchema>;

export const tuneBankSchema = z.object({ schemaVersion: z.literal(1), items: z.array(tuneSuggestionSchema).default([]) });
export type TuneBank = z.infer<typeof tuneBankSchema>;
export const tuneDeclinedSchema = z.object({ schemaVersion: z.literal(1), ids: z.array(z.string()).default([]) });

/** What a replace or archive took out, so nothing is lost. */
export const tuneHistorySchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(z.object({
    suggestionId: z.string(),
    operation: z.enum(["replace", "archive", "enrich"]),
    file: workspacePath,
    section: z.string(),
    oldText: z.string(),
    newText: z.string().optional(),
    reason: z.string(),
    at: z.string(),
  })).default([]),
});
export type TuneHistory = z.infer<typeof tuneHistorySchema>;

/** The same suggestion always gets the same ID, so a declined one is recognised when Agy suggests it again. */
export function tuneSuggestionId(area: TuneArea, suggestion: z.infer<typeof tuneSuggestionInputSchema>): string {
  const norm = (value: string | undefined) => (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const key = [area, suggestion.operation, suggestion.file, norm(suggestion.section), norm(suggestion.target), norm(suggestion.text)].join("\u0000");
  return `t-${hash48(key)}`;
}

/** A 48-bit string hash as 12 hex digits (cyrb53, cut to 48 bits); shared code runs in the renderer too, so no Node crypto. */
function hash48(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0) & 0xffff).toString(16).padStart(4, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** Highest urgency × impact first; ties keep their order. Declined IDs never come back. */
export function rankTuneSuggestions(items: TuneSuggestion[], declined: Iterable<string> = []): { shown: TuneSuggestion[]; banked: TuneSuggestion[] } {
  const skip = new Set(declined);
  const seen = new Set<string>();
  const ranked = items
    .filter((item) => !skip.has(item.id) && !seen.has(item.id) && seen.add(item.id))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.urgency * b.item.impact - a.item.urgency * a.item.impact || a.index - b.index)
    .map(({ item }) => item);
  return { shown: ranked.slice(0, TUNE_SHOWN), banked: ranked.slice(TUNE_SHOWN) };
}

/** Banked suggestions whose source file is unchanged; the others are stale and drop. */
export function freshBanked(bank: TuneSuggestion[], sourceHashes: Record<string, string | null>): TuneSuggestion[] {
  return bank.filter((item) => sourceHashes[item.source] === item.sourceHash);
}
