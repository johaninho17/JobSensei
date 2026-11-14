// Reads a PDF base resume into the Markdown the canonical parser reads (resume-sections.ts, canonical-resume.ts).
// One owner for turning PDF text into resume lines: bullets, wrapped lines, bold runs, column gaps, headings.
// The Recruiter Edition reads PDFs this way (features.pdfResumes); the regular app can switch it on with the flag.

export type PdfSegment = { text: string; bold: boolean };
export type PdfLine = { segments: PdfSegment[]; x: number; size: number; page: number };

type Item = { text: string; x: number; y: number; width: number; size: number; bold: boolean };

const BULLET = /^[•●▪‣◦○■□➢►✓✔·•●▪‣⁃*–-]\s*/;
const BOLD_FONT = /bold|black|heavy|semibold|demi/i;

/** Text items of each page with position, size, and whether the font is bold. */
async function pdfItems(buffer: Buffer): Promise<Item[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: Uint8Array.from(buffer), useSystemFonts: false, verbosity: 0, fontExtraProperties: true }).promise;
  const pages: Item[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    // Loading the operator list resolves each font's real name (e.g. "Calibri-Bold").
    await page.getOperatorList().catch(() => undefined);
    const fontName = (id: string): string => {
      try {
        const font = page.commonObjs.get(id) as { name?: string; bold?: boolean } | undefined;
        return `${font?.name ?? ""}${font?.bold ? " bold" : ""}`;
      } catch {
        return (content.styles as Record<string, { fontFamily?: string }>)[id]?.fontFamily ?? "";
      }
    };
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str) continue;
      const [a, b, , d, x, y] = raw.transform as number[];
      const size = Math.abs(d) || Math.hypot(a, b) || raw.height || 10;
      items.push({ text: raw.str, x, y, width: raw.width, size, bold: BOLD_FONT.test(fontName(raw.fontName)) });
    }
    pages.push(items);
  }
  return pages;
}

/** Groups a page's items into lines, top to bottom, left to right. Wide gaps become a tab (dates in a right column). */
export function linesFromItems(items: Item[], page = 1): PdfLine[] {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const rows: Item[][] = [];
  for (const item of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - item.y) <= Math.max(row[0]!.size, item.size) * 0.45) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    row.sort((left, right) => left.x - right.x);
    const segments: PdfSegment[] = [];
    let end: number | null = null;
    for (const item of row) {
      const text = item.text;
      if (!text.trim() && end === null) continue;
      let gap = "";
      if (end !== null) {
        const space = item.x - end;
        if (space > item.size * 2) gap = "\t";
        else if (space > item.size * 0.2 && !/\s$/.test(segments.at(-1)?.text ?? "") && !/^\s/.test(text)) gap = " ";
      }
      const last = segments.at(-1);
      const bold = item.bold && Boolean(text.trim());
      if (gap) {
        if (last) last.text += gap;
        else segments.push({ text: gap, bold: false });
      }
      const target = segments.at(-1);
      if (target && (target.bold === bold || !text.trim())) target.text += text;
      else segments.push({ text, bold });
      end = item.x + item.width;
    }
    const first = row.find((item) => item.text.trim());
    return { segments, x: first?.x ?? 0, size: Math.max(...row.map((item) => item.size)), page };
  }).filter((line) => line.segments.some((segment) => segment.text.trim()));
}

function plain(line: PdfLine): string {
  return line.segments.map((segment) => segment.text).join("").replace(/[  ]+/g, " ").trim();
}

/** The line with bold runs marked, as Word files arrive through mammoth (`**Company** — Title`). */
function marked(segments: PdfSegment[]): string {
  return segments
    .map((segment) => {
      const text = segment.text.replace(/[  ]+/g, " ");
      if (!segment.bold || !text.trim()) return text;
      const lead = text.match(/^\s*/)![0];
      const trail = text.match(/\s*$/)![0];
      return `${lead}**${text.trim()}**${trail}`;
    })
    .join("")
    .replace(/\*\*\s*\*\*/g, " ")
    .trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 10;
}

/** Turns the lines of a resume PDF into Markdown: bullets as `- `, wrapped lines joined, larger short lines as headings. */
export function pdfLinesToMarkdown(lines: PdfLine[]): string {
  const body = median(lines.flatMap((line) => Array(Math.max(1, plain(line).length)).fill(line.size)));
  // Bullets drawn as text (•, ▪, -) are read by their glyph. Browsers and some editors draw them as shapes, so when no
  // line starts with a glyph, a line indented past the page's left margin is a bullet.
  const glyphs = lines.filter((line) => BULLET.test(plain(line))).length >= 2;
  const margin = new Map<number, number>();
  for (const line of lines) margin.set(line.page, Math.min(margin.get(line.page) ?? Infinity, line.x));
  const out: string[] = [];
  let bullet: { index: number; x: number; text: number } | null = null;
  let paragraph: { index: number; x: number; size: number } | null = null;
  lines.forEach((line, position) => {
    const text = plain(line);
    const words = text.split(/\s+/).length;
    const allBold = line.segments.every((segment) => segment.bold || !segment.text.trim());
    const bigger = line.size > body * 1.15;
    const capitals = /[A-Z]/.test(text) && text === text.toUpperCase() && words <= 6;
    const heading = position > 0 && words <= 6 && !/[.:,]$/.test(text) && !/\d{4}/.test(text) && (capitals || (bigger && !allBold) || (allBold && words <= 4 && !/[|—–]/.test(text)));
    const indented = line.x > (margin.get(line.page) ?? 0) + 5;
    const glyphBullet = glyphs && BULLET.test(text) && !/^[-–]\s*\d/.test(text);
    const shapeBullet = !glyphs && indented && !heading && !allBold;
    // A wrapped bullet line: further right than the glyph, or (shape bullets) at the same indent while the bullet runs on.
    if (bullet && !heading && !allBold && !glyphBullet && out.length - 1 === bullet.index) {
      const previous = out[bullet.index]!;
      const continues = glyphs
        ? line.x > bullet.x + 0.5
        : Math.abs(line.x - bullet.text) < 1 && (!/[.!?;:)"”]$/.test(previous) || /^[a-z(&]/.test(text));
      if (continues) { out[bullet.index] = `${previous} ${marked(line.segments)}`; return; }
    }
    if (glyphBullet || shapeBullet) {
      const stripped = [...line.segments];
      stripped[0] = { ...stripped[0]!, text: stripped[0]!.text.replace(/^\s*/, "").replace(glyphBullet ? BULLET : /^$/, "") };
      out.push(`- ${marked(stripped).replace(glyphBullet ? BULLET : /^$/, "")}`);
      bullet = { index: out.length - 1, x: line.x, text: line.x };
      paragraph = null;
      return;
    }
    bullet = null;
    if (heading) {
      if (out.length && out.at(-1) !== "") out.push("");
      out.push(capitals || allBold ? `**${text.replace(/\*\*/g, "")}**` : `## ${text}`);
      out.push("");
      paragraph = null;
      return;
    }
    // A wrapped paragraph or skills line: same indent and size, and the previous line runs on.
    const previous = paragraph ? out[paragraph.index] ?? "" : "";
    if (paragraph && out.length - 1 === paragraph.index && Math.abs(line.x - paragraph.x) < 1 && Math.abs(line.size - paragraph.size) < 0.5
      && !allBold && !/^\*\*/.test(marked(line.segments)) && (/[,;&/–-]$/.test(previous) || /^[a-z]/.test(text)) && !/\t/.test(previous)) {
      out[paragraph.index] = `${previous} ${marked(line.segments)}`;
      return;
    }
    out.push(marked(line.segments));
    paragraph = { index: out.length - 1, x: line.x, size: line.size };
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A PDF resume as Markdown for the canonical parser, plus what was found (for "What JobSensei read"). */
export async function pdfResumeMarkdown(buffer: Buffer): Promise<{ markdown: string; warnings: string[] }> {
  const pages = await pdfItems(buffer);
  const lines = pages.flatMap((items, index) => linesFromItems(items, index + 1));
  if (!lines.length) {
    throw new Error("This PDF has no text JobSensei can read (it may be a scanned image). Use the Word (.docx) or Markdown (.md) version.");
  }
  return { markdown: pdfLinesToMarkdown(lines), warnings: ["Read from a PDF: check each role, its dates, and its bullets in What JobSensei read."] };
}
