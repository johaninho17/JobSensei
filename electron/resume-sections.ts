// The one reading of a resume's sections (ledger R3: each candidate's own format is kept, in any order).
// Used by the canonical parser (canonical-resume.ts) and the length measurement (resume-footprint.ts), so the two
// never disagree about where Experience starts or ends.

export function displayText(value: string): string {
  return value
    .replace(/\\([\\().,+-])/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

/** Word files are read through mammoth's HTML; this turns that HTML into the Markdown the parser reads. */
export function mammothHtmlToMarkdown(html: string): string {
  return decodeHtml(html)
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/?ul>|<p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^((?:#+\s*)?\*\*[^*\n]+?)\s*\n\*\*\s*/m, "$1**\n")
    .trim();
}

export type SectionKey = "summary" | "skills" | "experience" | "education" | "extra";

/** Headings the app understands, matched against the whole heading text (any case). */
const KNOWN: Array<[Exclude<SectionKey, "extra">, RegExp]> = [
  ["summary", /^(?:summary|professional\s+summary|career\s+summary|executive\s+summary|profile|professional\s+profile|about(?:\s+me)?|objective|career\s+objective)$/i],
  // "Skills", "Skills & Languages", "Technical Skills", "Clinical Skills", "Core Competencies", "Areas of Expertise".
  ["skills", /^(?:(?:[a-z]+(?:\s*&\s*|\s+)){0,3}skills(?:\s*(?:[-–—&,]|and)\s*[a-z ]+)?|core\s+competencies(?:\s*[-–—&]\s*technical\s+skills)?|competencies|areas\s+of\s+expertise|expertise)$/i],
  ["experience", /^(?:(?:professional|work|relevant|clinical|industry)\s+)?experience$|^(?:employment|work|career|professional)\s+history$|^employment$/i],
  ["education", /^education(?:\s*(?:[-–—&]|and)\s*(?:languages|training|certifications?|credentials))?$/i],
];

/** Other sections a resume may have (kept word for word): certifications, licenses, projects, volunteer work, … */
const EXTRA = /\b(?:certifications?|licen[sc]es?|projects?|volunteer(?:ing)?|awards?|honou?rs|publications?|languages|interests|activities|leadership|affiliations?|memberships?|training|references|additional\s+information|achievements|courses|coursework|military\s+service)\b/i;

/** Formatted like a heading: a Markdown heading, a fully bold line, or a line in capitals. */
function headingShaped(line: string): boolean {
  const trimmed = line.trim();
  const text = displayText(trimmed);
  if (!text || text.length > 60 || /[:.]$/.test(text) || /\d{4}/.test(text)) return false;
  return /^#{1,6}\s/.test(trimmed) || /^(?:\*\*|__)[^*_]+(?:\*\*|__)$/.test(trimmed) || (/[A-Z]/.test(text) && text === text.toUpperCase());
}

export type ResumeSection = { key: SectionKey; headingLine: string; lines: string[] };

/**
 * Splits a resume into its header and sections, in the resume's own order. Skills, Experience, and Education are
 * found by name wherever they are; other headings after the first known section become extra sections.
 */
export function resumeSections(markdown: string): { headerLines: string[]; sections: ResumeSection[] } {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const known = new Map<number, Exclude<SectionKey, "extra">>();
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const text = displayText(line);
    const match = KNOWN.find(([key, pattern]) => !seen.has(key) && pattern.test(text));
    // A known name only counts as a section when it stands alone on its line (no "Skills: …").
    if (match && !/^[-*+]\s/.test(line.trim())) { known.set(index, match[0]); seen.add(match[0]); }
  });
  const first = Math.min(...known.keys());
  if (!Number.isFinite(first)) return { headerLines: lines, sections: [] };
  const starts = [...known.entries()].map(([index, key]) => ({ index, key: key as SectionKey }));
  lines.forEach((line, index) => {
    if (index <= first || known.has(index) || /^[-*+]\s/.test(line.trim())) return;
    const text = displayText(line);
    if (headingShaped(line) && text.split(/\s+/).length <= 6 && EXTRA.test(text)) starts.push({ index, key: "extra" });
  });
  starts.sort((a, b) => a.index - b.index);
  const sections = starts.map((start, position) => ({
    key: start.key,
    headingLine: lines[start.index]!.trim(),
    lines: lines.slice(start.index + 1, starts[position + 1]?.index ?? lines.length),
  }));
  return { headerLines: lines.slice(0, first), sections };
}

/** The bullets under Experience, as the parser reads them. */
export function experienceBulletLines(markdown: string): { all: string[]; firstEmployer: string[] } {
  const experience = resumeSections(markdown).sections.find((section) => section.key === "experience");
  const all: string[] = [];
  const firstEmployer: string[] = [];
  let employers = 0;
  let inBullets = false;
  for (const raw of experience?.lines ?? []) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*+]\s+/.test(line)) {
      if (!inBullets) employers += 1;
      inBullets = true;
      const bullet = line.replace(/^[-*+]\s+/, "").trim();
      all.push(bullet);
      if (employers === 1) firstEmployer.push(bullet);
    } else {
      inBullets = false;
    }
  }
  return { all, firstEmployer };
}
