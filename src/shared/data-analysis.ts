import { z } from "zod";

/**
 * Data analysis (#200, decision U120): where the candidate's career records are thin, stale, conflicting, or duplicated.
 * The app builds the brief (electron/data-analysis.ts), Agy answers in this JSON shape
 * (.agents/workflows/jobsensei-data-analysis.md), `checkFindings` drops anything outside the rules, and the user accepts,
 * edits, asks, or refuses each finding. Nothing changes without a pick.
 */

export const FINDING_KINDS = ["thin", "stale", "conflict", "duplicate"] as const;
export const FIX_ACTIONS = ["update", "add", "remove", "ask"] as const;

/** The row fields of a fix: the same shape answer filing writes (electron/answer-filing.ts `RecordRow`, minus locator). */
export const fixRowSchema = z.object({
  evidenceId: z.string().default(""),
  year: z.string().default(""),
  project: z.string().default(""),
  claim: z.string().default(""),
  scope: z.string().default(""),
  publicUse: z.string().default("eligible"),
});
export type FixRow = z.infer<typeof fixRowSchema>;

export const findingSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(FINDING_KINDS),
  /** What it is about in a few words (a tool, an employer, a project); part of the key that remembers a refusal. */
  subject: z.string().min(1).max(80),
  file: z.string(),
  rowId: z.string().nullable().default(null),
  issue: z.string().min(1).max(300),
  basis: z.array(z.object({ file: z.string(), quote: z.string().min(3).max(400) })).min(1).max(4),
  fix: z.object({
    action: z.enum(FIX_ACTIONS),
    row: fixRowSchema.nullable().default(null),
    question: z.string().max(300).nullable().default(null),
  }),
});
export type Finding = z.infer<typeof findingSchema>;

export const replySchema = z.object({
  findings: z.array(z.unknown()).default([]),
  skipped: z.array(z.object({ subject: z.string(), reason: z.string() })).default([]),
});

/** JSON schema handed to `agy -p` so the reply has this shape. */
export const FINDINGS_JSON_SCHEMA = JSON.stringify({
  type: "object",
  required: ["findings", "skipped"],
  properties: {
    findings: { type: "array", items: { type: "object", required: ["id", "kind", "subject", "file", "rowId", "issue", "basis", "fix"], properties: {
      id: { type: "string" }, kind: { type: "string", enum: [...FINDING_KINDS] }, subject: { type: "string" }, file: { type: "string" }, rowId: { type: ["string", "null"] }, issue: { type: "string" },
      basis: { type: "array", items: { type: "object", required: ["file", "quote"], properties: { file: { type: "string" }, quote: { type: "string" } } } },
      fix: { type: "object", required: ["action"], properties: {
        action: { type: "string", enum: [...FIX_ACTIONS] },
        row: { type: ["object", "null"], properties: { evidenceId: { type: "string" }, year: { type: "string" }, project: { type: "string" }, claim: { type: "string" }, scope: { type: "string" }, publicUse: { type: "string" } } },
        question: { type: ["string", "null"] } } } } } },
    skipped: { type: "array", items: { type: "object", required: ["subject", "reason"], properties: { subject: { type: "string" }, reason: { type: "string" } } } },
  },
});

/** One finding as the app stores and shows it. */
export type StoredFinding = Finding & { key: string; status: "open" | "accepted" | "asked" | "refused" };
export type AnalysisView = {
  ranAt: string | null;
  running: boolean;
  findings: StoredFinding[];
  /** Findings Agy proposed that broke a rule, with why (kept for checking, not shown as choices). */
  dropped: Array<{ id: string; reason: string }>;
  error: string | null;
};

const normal = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/** Remembers a refusal: the same kind of finding about the same subject in the same file and row never comes back. */
export function findingKey(finding: Pick<Finding, "kind" | "file" | "rowId" | "subject">): string {
  return [finding.kind, finding.file, finding.rowId ?? "-", normal(finding.subject)].join("|");
}

const numbers = (text: string) => text.match(/\d[\d,.]*%?/g)?.map((value) => value.replace(/[,.]$/, "")) ?? [];

export type CheckInput = {
  /** Text of every file Agy may quote, by workspace path. */
  texts: Record<string, string>;
  /** Career record files Agy may change, with each row's ID and its full line. */
  records: Record<string, Map<string, string>>;
  refused: Set<string>;
};

/**
 * The rules a finding must pass before the user sees it. Each failure drops the finding with a reason; nothing is
 * repaired. Owner of these rules: this function (the workflow describes them to Agy).
 */
export function checkFindings(raw: unknown[], input: CheckInput): { kept: Finding[]; dropped: Array<{ id: string; reason: string }> } {
  const kept: Finding[] = [];
  const dropped: Array<{ id: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const parsed = findingSchema.safeParse(item);
    const id = parsed.success ? parsed.data.id : String((item as { id?: unknown })?.id ?? `#${index + 1}`);
    const drop = (reason: string) => dropped.push({ id, reason });
    if (!parsed.success) { drop(`not in the findings shape (${parsed.error.issues[0]?.path.join(".") ?? "?"})`); continue; }
    const finding = parsed.data;
    const key = findingKey(finding);
    if (input.refused.has(key)) { drop("refused before"); continue; }
    if (seen.has(key)) { drop("same as another finding"); continue; }
    const rows = input.records[finding.file];
    if (!rows) { drop(`${finding.file} is not a career record file`); continue; }
    const badQuote = finding.basis.find((basis) => !input.texts[basis.file] || !normal(input.texts[basis.file]!).includes(normal(basis.quote)));
    if (badQuote) { drop(`quote not found in ${badQuote.file}`); continue; }
    const { action, row, question } = finding.fix;
    if (finding.kind === "thin" && action !== "ask") { drop("a thin finding can only ask the candidate"); continue; }
    if (action === "ask") {
      if (!question?.trim()) { drop("ask without a question"); continue; }
    } else {
      if (!row) { drop(`${action} without a row`); continue; }
      if (action !== "add") {
        const target = finding.rowId ?? row.evidenceId;
        if (!target || !rows.has(target.trim().toLowerCase())) { drop(`row ${target || "(none)"} is not in ${finding.file}`); continue; }
      }
      if (action !== "remove") {
        if (!row.claim.trim()) { drop("a row without a claim"); continue; }
        // No number the candidate's own text doesn't already hold (T1).
        const allowed = new Set([...finding.basis.flatMap((basis) => numbers(basis.quote)), ...numbers(rows.get((finding.rowId ?? row.evidenceId).trim().toLowerCase()) ?? "")]);
        const invented = numbers(`${row.claim} ${row.scope}`).find((value) => !allowed.has(value));
        if (invented) { drop(`number ${invented} is not in the quoted text`); continue; }
      }
    }
    seen.add(key);
    kept.push(finding);
  }
  return { kept, dropped };
}
