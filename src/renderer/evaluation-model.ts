export type EvaluationRequirement = {
  requirement: string;
  category: string;
  weight: number;
  material: boolean;
  classification: string;
  evidence: string;
};

export const evaluationCredits: Record<string, number> = {
  direct: 1,
  strong_transferable: 0.75,
  adjacent_transferable: 0.55,
  unclear: 0.25,
  gap: 0,
};

export const evaluationCategoryLabels: Record<string, string> = {
  core: "Core responsibilities",
  technical: "Technical capabilities",
  scope: "Scope and communication",
  outcomes: "Relevant outcomes",
  domain: "Domain familiarity",
  learning: "Learning and transferability",
};

export function parseEvaluationRequirements(markdown: string): EvaluationRequirement[] {
  const section = /###\s+Requirement Scoring\s*\n([\s\S]*?)(?=\n#{1,3}\s+|<!-- jobsensei-application-audit:start -->|$)/i.exec(markdown)?.[1];
  if (!section) return [];
  const lines = section.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (lines.length < 3) return [];
  const cells = (line: string) => line.trim().slice(1, -1).split("|").map((value) => value.trim().replaceAll("`", ""));
  const headers = cells(lines[0]).map((value) => value.toLowerCase().replace(/[^a-z]+/g, " ").trim());
  const column = (name: string) => headers.indexOf(name);
  if (["requirement", "category", "weight", "material", "classification", "evidence"].some((name) => column(name) < 0)) return [];
  return lines.slice(2).map(cells).map((row) => ({
    requirement: row[column("requirement")] ?? "",
    category: (row[column("category")] ?? "").toLowerCase().replaceAll(" ", "_"),
    weight: Number((row[column("weight")] ?? "").replace("%", "")),
    material: /^(?:yes|true)$/i.test(row[column("material")] ?? ""),
    classification: (row[column("classification")] ?? "").toLowerCase().replaceAll(" ", "_"),
    evidence: row[column("evidence")] ?? "",
  })).filter((row) => row.requirement && Number.isFinite(row.weight));
}

export function evaluationLabel(markdown: string, label: RegExp): string | null {
  const match = markdown.match(new RegExp(`(?:^|\\n)[^\\n]*${label.source}\\*{0,2}\\s*:\\*{0,2}\\s*([^\\n]+)`, "i"));
  return match?.[1]?.replace(/[`*]/g, "").trim() ?? null;
}

export function evaluationSection(markdown: string, heading: RegExp): string {
  return new RegExp(`^##{1,2}\\s+[^\\n]*${heading.source}[^\\n]*\\n([\\s\\S]*?)(?=^##{1,2}\\s+|<!-- jobsensei-application-audit:start -->|$)`, "im").exec(markdown)?.[1]?.trim() ?? "";
}
