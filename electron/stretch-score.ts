import type { StretchScore } from "../src/shared/schemas";

/**
 * How far the drafts reach past the candidate's evidence, shown beside the fit score and never
 * changing it. Tailoring is how much of the resume changed from the base resume. Each changed line
 * gets a level: 0 as its evidence says, 1 reworded, 2 framed stronger (ownership, scope, or absolute
 * words its rows don't use), 3 unsupported (it failed the grounding check).
 */

export type StretchLine = {
  text: string;
  artifact: "resume" | "cover-letter";
  claimType: string;
  evidenceIds: string[];
};

const FRAMING_WORDS = /\b(?:led|lead|owned|own|spearheaded|architected|drove|directed|managed|headed|championed|pioneered|enterprise(?:-wide)?|global|strategic|across|all|every|end-to-end|large-scale|multiple|organization-wide|company-wide|always|consistently|strictly)\b/gi;

function normalize(value: string): string {
  return value.replaceAll("\\-", "-").replace(/[*_`#|]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function words(value: string): Set<string> {
  return new Set(normalize(value).split(/[^a-z0-9+#]+/).filter((word) => word.length >= 3));
}

/** Share of the line's words found in its rows (0..1). */
function overlap(line: string, rows: string): number {
  const lineWords = words(line);
  if (!lineWords.size) return 1;
  const rowWords = words(rows);
  return [...lineWords].filter((word) => rowWords.has(word)).length / lineWords.size;
}

export function scoreStretch(input: {
  lines: StretchLine[];
  /** Base-resume bullets and skills lines. */
  baselineLines: string[];
  /** Evidence row text by ID (claim and scope). */
  rowText: Map<string, string>;
  /** Lines that failed the grounding check, with the check's message. */
  unsupported: Array<{ text: string; reason: string }>;
}): StretchScore {
  const baseline = new Set(input.baselineLines.map(normalize));
  const unsupported = new Map(input.unsupported.map((line) => [normalize(line.text), line.reason]));
  const resumeLines = input.lines.filter((line) => line.artifact === "resume");
  const changedResume = resumeLines.filter((line) => line.claimType !== "baseline" && !baseline.has(normalize(line.text)));
  const tailoredPercent = resumeLines.length ? Math.round(changedResume.length / resumeLines.length * 100) : 0;

  const factual = input.lines.filter((line) =>
    !["baseline", "non-factual", "employer"].includes(line.claimType) && !baseline.has(normalize(line.text)));
  const rated = factual.map((line) => {
    const rows = line.evidenceIds.map((id) => input.rowText.get(id) ?? "").join(" ");
    if (unsupported.has(normalize(line.text))) return { ...line, level: 3 as const, reason: unsupported.get(normalize(line.text)) || "Not supported by its cited evidence." };
    const rowWords = words(rows);
    const framing = [...new Set((line.text.match(FRAMING_WORDS) ?? []).map((word) => word.toLowerCase()))].filter((word) => !rowWords.has(word));
    if (framing.length) return { ...line, level: 2 as const, reason: `Stronger than its evidence: ${framing.join(", ")}.` };
    if (overlap(line.text, rows) < 0.5) return { ...line, level: 1 as const, reason: "Reworded from its evidence." };
    return { ...line, level: 0 as const, reason: "As its evidence says." };
  });
  const count = (level: number) => rated.filter((line) => line.level === level).length;
  const average = rated.length ? rated.reduce((sum, line) => sum + line.level, 0) / rated.length : 0;
  const level = count(3) >= 2 || average >= 1.6 ? "high" : count(3) >= 1 || average >= 0.9 ? "medium" : "low";
  return {
    level,
    tailoredPercent,
    average: Math.round(average * 100) / 100,
    counts: { asEvidence: count(0), reworded: count(1), framed: count(2), unsupported: count(3) },
    top: [...rated]
      .filter((line) => line.level > 0)
      .sort((a, b) => b.level - a.level)
      .slice(0, 3)
      .map((line) => ({ text: line.text, artifact: line.artifact, level: line.level, reason: line.reason, evidenceIds: line.evidenceIds })),
  };
}
