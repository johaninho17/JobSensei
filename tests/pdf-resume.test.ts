// A PDF base resume is read into the same structure as its Word/Markdown version (features.pdfResumes).
// The PDFs are made here from the fictional fixtures (tests/fixtures/resumes), so nothing real is involved.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadCanonicalResumeBaseline } from "../electron/canonical-resume";
import { checkBaseResume } from "../electron/setup-readiness";

const fixtures = join(__dirname, "fixtures", "resumes");
const CP1252: Record<string, number> = { "—": 0x97, "–": 0x96, "•": 0x95, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94 };

function pdfString(text: string): string {
  const bytes = [...text].map((char) => String.fromCharCode(CP1252[char] ?? (char.charCodeAt(0) < 256 ? char.charCodeAt(0) : 63)));
  return `(${bytes.join("").replace(/([\\()])/g, "\\$1")})`;
}

/** A one-column resume PDF from a fixture's Markdown: bold runs in Helvetica-Bold, bullets as •, tabs as a right column. */
export function resumePdf(markdown: string): Buffer {
  const pages: string[][] = [[]];
  let ops = pages[0]!;
  let y = 770;
  const segment = (text: string, x: number, size: number) => {
    if (y < 50) { ops = []; pages.push(ops); y = 770; }
    const parts = text.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
    ops.push(`BT ${x} ${y} Td`);
    for (const part of parts) {
      const bold = part.startsWith("**");
      ops.push(`/${bold ? "F2" : "F1"} ${size} Tf ${pdfString(bold ? part.slice(2, -2) : part)} Tj`);
    }
    ops.push("ET");
  };
  markdown.split("\n").forEach((raw, index) => {
    const line = raw.trimEnd();
    if (!line.trim()) { y -= 6; return; }
    const size = index === 0 ? 16 : 10;
    if (/^- /.test(line)) {
      let words = line.slice(2).split(" ");
      let first = true;
      while (words.length) {
        let text = "";
        while (words.length && (text + words[0]).length < 70) text += `${words.shift()} `;
        if (!text) text = `${words.shift()} `;
        if (first) segment("•", 50, size);
        segment(text.trim(), 60, size);
        first = false;
        y -= size * 1.35;
      }
      return;
    }
    const [left, right] = line.split("\t");
    segment(left!, 50, size);
    if (right) segment(right, 400, size);
    y -= size * 1.35;
  });
  const font = (name: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  // Objects: 1 catalog, 2 pages, 3-4 fonts, then a page and its content stream per page.
  const kids = pages.map((_page, index) => `${5 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    font("Helvetica"),
    font("Helvetica-Bold"),
    ...pages.flatMap((page, index) => {
      const stream = page.join("\n");
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
        `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
      ];
    }),
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const shape = (baseline: Awaited<ReturnType<typeof loadCanonicalResumeBaseline>>) => ({
  employers: baseline.employers.map((employer) => [employer.name, employer.title, employer.dateRange, employer.originalBulletCount]),
  skills: baseline.originalSkillsLines.length,
  education: baseline.educationLines.length,
  summary: Boolean(baseline.originalSummaryLines?.length),
});

describe("PDF base resumes", () => {
  let folder: string;
  const edition = process.env.JOBSENSEI_EDITION;
  beforeAll(async () => { folder = await mkdtemp(join(tmpdir(), "pdf-resume-")); });
  afterAll(async () => { await rm(folder, { recursive: true, force: true }); });
  afterEach(() => { process.env.JOBSENSEI_EDITION = edition ?? ""; if (!edition) delete process.env.JOBSENSEI_EDITION; });

  for (const file of ["half-page-retail.md", "one-page-summary-sales.md", "two-page-nursing.md"]) {
    it(`reads ${file} as a PDF with the same roles, dates, bullets, and sections (Recruiter Edition)`, async () => {
      process.env.JOBSENSEI_EDITION = "recruiter";
      const markdown = await readFile(join(fixtures, file), "utf8");
      const pdf = file.replace(/\.md$/, ".pdf");
      await writeFile(join(folder, pdf), resumePdf(markdown));
      const fromMarkdown = await loadCanonicalResumeBaseline(fixtures, file);
      const fromPdf = await loadCanonicalResumeBaseline(folder, pdf);
      expect(shape(fromPdf)).toEqual(shape(fromMarkdown));
      expect(fromPdf.structureSource).toBe("pdf");
      expect(fromPdf.employers[0]!.originalBullets).toEqual(fromMarkdown.employers[0]!.originalBullets.map((bullet) => bullet.replace(/\*\*/g, "")));
      expect(fromPdf.footprint.experienceBulletCount).toBe(fromMarkdown.footprint.experienceBulletCount);
    });
  }

  it("still needs a Word or Markdown copy in the regular app", async () => {
    delete process.env.JOBSENSEI_EDITION;
    const markdown = await readFile(join(fixtures, "half-page-retail.md"), "utf8");
    const only = await mkdtemp(join(tmpdir(), "pdf-only-"));
    await writeFile(join(only, "resume.pdf"), resumePdf(markdown));
    await expect(loadCanonicalResumeBaseline(only, "resume.pdf")).rejects.toThrow(/PDF with no Word or Markdown/);
    await rm(only, { recursive: true, force: true });
  });

  it("shows what was read from a PDF in the Recruiter Edition's resume check", async () => {
    process.env.JOBSENSEI_EDITION = "recruiter";
    const markdown = await readFile(join(fixtures, "one-page-summary-sales.md"), "utf8");
    await writeFile(join(folder, "check.pdf"), resumePdf(markdown));
    const check = await checkBaseResume(folder, "check.pdf");
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.employers).toBe(3);
      expect(check.lines.some((line) => /Read from a PDF/.test(line))).toBe(true);
    }
  });
});
