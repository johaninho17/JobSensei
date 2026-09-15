export type QuestionEntry = {
  id: string;
  text: string;
  section: string;
  lineIndex: number;
};

function plainText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`"#]/g, "")
    .replace(/^Question\s+\d+\s*:\s*/i, "")
    .trim();
}

function slug(value: string): string {
  return plainText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54) || "question";
}

export function parseQuestionBank(markdown: string): QuestionEntry[] {
  const entries: QuestionEntry[] = [];
  const occurrences = new Map<string, number>();
  let section = "Questions";
  markdown.replaceAll("\r\n", "\n").split("\n").forEach((line, lineIndex) => {
    const sectionHeading = /^##\s+(.+)$/.exec(line);
    if (sectionHeading) {
      section = plainText(sectionHeading[1]);
      return;
    }
    const questionHeading = /^###\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const candidate = questionHeading?.[1]
      ?? (numbered && /follow.?up|questions to ask|reverse/i.test(section) ? numbered[1] : null);
    if (!candidate) return;
    const text = plainText(candidate).replace(/^["“]|["”]$/g, "").trim();
    if (!text || (!questionHeading && !text.includes("?"))) return;
    const base = slug(text);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    entries.push({
      id: `question-${base}${occurrence > 1 ? `-${occurrence}` : ""}`,
      text,
      section,
      lineIndex,
    });
  });
  return entries;
}
