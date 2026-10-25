// Parses interview round Markdown (question_bank.md, prep.md, story_bank.md) into structured cards for the interview view.
// Reads both the current card format (pipeline SKILL "Question card") and older free-form banks.

export type CardKind = "question" | "gap" | "followup" | "ask";

export type InterviewCard = {
  id: string;
  kind: CardKind;
  question: string;
  why: string | null;
  example: string | null;
  cues: string[];
  approach: string[];
  landOn: string | null;
  careful: string | null;
  gap: string | null;
  closest: string | null;
  ramp: string | null;
  /** Anything else under the card (older banks: "Suggested answer" and STAR notes), as Markdown. */
  notes: string | null;
};

export type MarkdownSection = { title: string; body: string };

const FIELD_LINE = /^\s*(?:[-*]\s+)?\*\*([^*]+?):?\*\*:?\s*(.*)$/;

function plain(value: string): string {
  return value.replace(/\[([^\]]+)]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
}

function sectionKind(title: string): CardKind {
  if (/gap/i.test(title)) return "gap";
  if (/follow/i.test(title)) return "followup";
  if (/ask|reverse/i.test(title)) return "ask";
  return "question";
}

function isNone(value: string | null): boolean {
  return !value || /^none\b|^n\/a\b|^—$/i.test(value.trim());
}

function splitCues(value: string): string[] {
  return value.split(/\s+·\s+|\s*;\s*|\s+\|\s+/).map(plain).filter(Boolean);
}

function splitSteps(value: string): string[] {
  const steps = value.split(/\s*(?:^|\s)\d+[).]\s+/).map(plain).filter(Boolean);
  return steps.length ? steps : [plain(value)];
}

/** Splits Markdown into `##` sections (title without the hashes, body below it). */
export function markdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { title: plain(heading[1]!), body: "" };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) sections.push(current);
  return sections.map((section) => ({ ...section, body: section.body.trim() }));
}

/** Bullet or numbered list items in a Markdown block, as plain text. */
export function listItems(markdown: string): string[] {
  return markdown.split("\n")
    .map((line) => /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line)?.[1])
    .filter((item): item is string => Boolean(item))
    .map(plain);
}

function emptyCard(id: string, kind: CardKind, question: string): InterviewCard {
  return { id, kind, question, why: null, example: null, cues: [], approach: [], landOn: null, careful: null, gap: null, closest: null, ramp: null, notes: null };
}

export function parseInterviewCards(markdown: string): InterviewCard[] {
  const cards: InterviewCard[] = [];
  const counts = new Map<CardKind, number>();
  const nextId = (kind: CardKind) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return `${kind}-${count}`;
  };
  for (const section of markdownSections(markdown)) {
    const kind = sectionKind(section.title);
    const blocks = section.body.split(/\n(?=###\s+)/);
    for (const block of blocks) {
      const heading = /^###\s+(.+)$/m.exec(block);
      if (!heading) {
        // Questions to ask and follow-ups are often a plain list.
        if (kind === "ask" || kind === "followup") {
          for (const item of listItems(block)) if (!FIELD_LINE.test(item)) cards.push(emptyCard(nextId(kind), kind, item));
        }
        continue;
      }
      const question = plain(heading[1]!).replace(/^(?:question|gap|q)\s*\d+\s*[:.)-]\s*/i, "");
      const card = emptyCard(nextId(kind), kind, question);
      const notes: string[] = [];
      let lastField: string | null = null;
      for (const line of block.split("\n").slice(block.split("\n").indexOf(heading[0]) + 1)) {
        const field = FIELD_LINE.exec(line);
        if (field) {
          const label = field[1]!.trim().toLowerCase();
          const value = field[2]!.trim();
          lastField = label;
          if (/^why they ask$|^what it tests$|^why$/.test(label)) card.why = plain(value);
          else if (/^real example$|^example$|^story$/.test(label)) card.example = isNone(value) ? null : plain(value);
          else if (/^cues?$/.test(label)) card.cues = splitCues(value);
          else if (/^your approach$|^approach$/.test(label)) card.approach = splitSteps(value);
          else if (/^land on$/.test(label)) card.landOn = plain(value);
          else if (/^careful$|^watch out$/.test(label)) card.careful = plain(value);
          else if (/^gap$/.test(label)) card.gap = plain(value);
          else if (/^closest real experience$/.test(label)) card.closest = plain(value);
          else if (/^ramp plan$/.test(label)) card.ramp = plain(value);
          else { lastField = null; notes.push(line); }
          continue;
        }
        if (line.trim() && lastField === null) notes.push(line);
        else if (line.trim()) notes.push(line);
      }
      const noteText = notes.join("\n").trim();
      card.notes = noteText || null;
      cards.push(card);
    }
  }
  return cards;
}

/** Story titles by ID from `profile/story_bank.md` headings like `## S2 · Partner launch`. */
export function storyTitles(markdown: string): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const match of markdown.matchAll(/^##\s+(S\d{1,2})\b\s*[·:—–-]?\s*(.*)$/gm)) titles[match[1]!] = plain(match[2] ?? "");
  return titles;
}
