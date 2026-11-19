// A round's question cards as data (#113, ledger I22). Agy writes `interviews/<round>/question_bank.json`; the app
// checks it and writes `question_bank.md` from it with `renderQuestionBank`, so the cards look the same every run.
// The card fields are question card v3 (ledger I18); the interview pipeline skill owns what goes in each field, and
// `electron/interview-check.ts` owns the quality checks, which read the rendered Markdown like any other bank.
import { z } from "zod";

export const QUESTION_BANK_JSON = "question_bank.json";

/** One line of text: newlines and runs of spaces become one space, so a field can't break the card layout. */
const line = z.string().transform((value) => value.replace(/\s+/g, " ").trim()).pipe(z.string().min(1));
const optionalLine = z.string().transform((value) => value.replace(/\s+/g, " ").trim() || undefined).optional();

/** A plain-words fact with the story or evidence IDs it comes from (shown in trailing parentheses, hidden in the UI). */
const cited = z.object({ text: line, ids: z.array(line).default([]) });

const questionCardSchema = z.object({
  question: line,
  whyTheyAsk: line,
  /** What the answer is made of: 3–5 concrete points. */
  say: z.array(line).min(1).max(6),
  /** Left out of motivation and logistics cards. */
  proof: cited.optional(),
  /** Only for hypotheticals and depth probes. */
  approach: z.array(line).max(6).optional(),
  /** Only where an interviewer will most likely push. */
  followUp: z.object({ question: line, cue: line }).optional(),
  landOn: line,
  careful: optionalLine,
});

const gapCardSchema = z.object({
  question: line,
  gap: line,
  closestExperience: cited,
  rampPlan: line,
  landOn: line,
});

export const questionBankSchema = z.object({
  schemaVersion: z.literal(1),
  primary: z.array(questionCardSchema).min(1),
  gaps: z.array(gapCardSchema).default([]),
  questionsToAsk: z.array(line).default([]),
});
export type QuestionBank = z.infer<typeof questionBankSchema>;
export type QuestionBankInput = z.input<typeof questionBankSchema>;

const asked = (question: string) => /[?]$/.test(question) ? question : `${question.replace(/[.!]+$/, "")}?`;
const withIds = (fact: { text: string; ids: string[] }) => fact.ids.length ? `${fact.text} (${fact.ids.join(", ")})` : fact.text;

/** The Markdown the app writes from a checked bank: the card format the app and its checks read. */
export function renderQuestionBank(bank: QuestionBank, title: string): string {
  const out: string[] = [`# ${title}`, "", "## Primary for this round", ""];
  bank.primary.forEach((card, index) => {
    out.push(`### Question ${index + 1}: ${asked(card.question)}`);
    out.push(`- **Why they ask:** ${card.whyTheyAsk}`);
    out.push(`- **Say:** ${card.say.join(" · ")}`);
    if (card.proof) out.push(`- **Proof:** ${withIds(card.proof)}`);
    if (card.approach?.length) out.push(`- **Your approach:** ${card.approach.map((step, n) => `${n + 1}) ${step}`).join(" ")}`);
    if (card.followUp) out.push(`- **Likely follow-up:** ${asked(card.followUp.question)} → ${card.followUp.cue}`);
    out.push(`- **Land on:** ${card.landOn}`);
    if (card.careful) out.push(`- **Careful:** ${card.careful}`);
    out.push("");
  });
  out.push("## Gap questions", "");
  bank.gaps.forEach((gap, index) => {
    out.push(`### Gap ${index + 1}: ${asked(gap.question)}`);
    out.push(`- **Gap:** ${gap.gap}`);
    out.push(`- **Closest real experience:** ${withIds(gap.closestExperience)}`);
    out.push(`- **Ramp plan:** ${gap.rampPlan}`);
    out.push(`- **Land on:** ${gap.landOn}`);
    out.push("");
  });
  out.push("## Questions to ask", ...bank.questionsToAsk.map((question) => `- ${asked(question)}`), "");
  return out.join("\n");
}

/** The first few problems in a bank that doesn't match the format, in plain words for the check report. */
export function questionBankProblems(error: z.ZodError): string[] {
  return error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`);
}
