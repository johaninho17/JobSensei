import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import mammoth from "mammoth";
import { resumeFootprintSchema, type ResumeFootprint } from "../src/shared/schemas";
import { assertInsideWorkspace } from "./workspace";

const MIN_FOOTPRINT_RATIO = 1;
const MAX_FOOTPRINT_RATIO = 1.1;
const MIN_EXPERIENCE_RATIO = 0.95;
const MAX_EXPERIENCE_RATIO = 1.05;

export async function profileBaseResume(workspacePath: string, relativePath: string): Promise<ResumeFootprint> {
  const path = assertInsideWorkspace(workspacePath, resolve(workspacePath, relativePath));
  const extension = extname(path).toLowerCase();
  try {
    if (extension === ".md") return markdownFootprint(relativePath, await readFile(path, "utf8"));
    if (extension === ".docx") return await docxFootprint(relativePath, await readFile(path));
    if (extension === ".pdf") return await pdfFootprint(relativePath, await readFile(path));
    return unavailableFootprint(relativePath, "unknown", "The selected base resume format cannot be profiled.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const format = extension === ".md" ? "markdown" : extension === ".docx" ? "docx" : extension === ".pdf" ? "pdf" : "unknown";
    return unavailableFootprint(relativePath, format, `Resume footprint unavailable: ${message}`);
  }
}

export function markdownFootprint(sourcePath: string, markdown: string): ResumeFootprint {
  const wordCount = countWords(markdown);
  const bullets = experienceBullets(markdown);
  const experienceWordCount = countWords(bullets.join(" "));
  const currentEmployerBullets = firstEmployerBullets(markdown);
  return resumeFootprintSchema.parse({
    sourcePath,
    format: "markdown",
    status: "reliable",
    wordCount,
    experienceBulletCount: bullets.length,
    currentEmployerBulletCount: currentEmployerBullets.length,
    targetWordMin: Math.floor(wordCount * MIN_FOOTPRINT_RATIO),
    targetWordMax: Math.ceil(wordCount * MAX_FOOTPRINT_RATIO),
    experienceWordCount,
    averageExperienceBulletWords: bullets.length ? experienceWordCount / bullets.length : null,
    targetExperienceWordMin: Math.floor(experienceWordCount * MIN_EXPERIENCE_RATIO),
    targetExperienceWordMax: Math.ceil(experienceWordCount * MAX_EXPERIENCE_RATIO),
    warnings: [],
  });
}

async function docxFootprint(sourcePath: string, buffer: Buffer): Promise<ResumeFootprint> {
  const [raw, html] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ]);
  const wordCount = countWords(raw.value);
  const professionalHtml = sectionHtml(html.value, "PROFESSIONAL EXPERIENCE", "EDUCATION");
  const lists = [...professionalHtml.matchAll(/<ul[^>]*>([\s\S]*?)<\/ul>/gi)]
    .map((match) => match[1]);
  const listCounts = lists
    .map((list) => list.match(/<li\b/gi)?.length ?? 0)
    .filter((count) => count > 0);
  const experienceText = lists
    .flatMap((list) => [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => stripHtml(match[1])))
    .join(" ");
  const experienceWordCount = countWords(experienceText);
  const experienceBulletCount = listCounts.reduce((sum, count) => sum + count, 0) || null;
  const currentEmployerBulletCount = listCounts[0] ?? null;
  const reliable = experienceBulletCount !== null && currentEmployerBulletCount !== null;
  return resumeFootprintSchema.parse({
    sourcePath,
    format: "docx",
    status: reliable ? "reliable" : "partial",
    wordCount,
    experienceBulletCount,
    currentEmployerBulletCount,
    targetWordMin: Math.floor(wordCount * MIN_FOOTPRINT_RATIO),
    targetWordMax: Math.ceil(wordCount * MAX_FOOTPRINT_RATIO),
    experienceWordCount: reliable ? experienceWordCount : null,
    averageExperienceBulletWords: reliable && experienceBulletCount ? experienceWordCount / experienceBulletCount : null,
    targetExperienceWordMin: reliable ? Math.floor(experienceWordCount * MIN_EXPERIENCE_RATIO) : null,
    targetExperienceWordMax: reliable ? Math.ceil(experienceWordCount * MAX_EXPERIENCE_RATIO) : null,
    warnings: reliable ? [] : ["DOCX text was extracted, but list structure could not be measured reliably."],
  });
}

async function pdfFootprint(sourcePath: string, buffer: Buffer): Promise<ResumeFootprint> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: Uint8Array.from(buffer) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  const text = pages.join("\n");
  const wordCount = countWords(text);
  return resumeFootprintSchema.parse({
    sourcePath,
    format: "pdf",
    status: "partial",
    wordCount,
    experienceBulletCount: null,
    currentEmployerBulletCount: null,
    targetWordMin: Math.floor(wordCount * MIN_FOOTPRINT_RATIO),
    targetWordMax: Math.ceil(wordCount * MAX_FOOTPRINT_RATIO),
    experienceWordCount: null,
    averageExperienceBulletWords: null,
    targetExperienceWordMin: null,
    targetExperienceWordMax: null,
    warnings: ["PDF text density was measured, but bullet structure requires Markdown or DOCX for reliable counting."],
  });
}

function unavailableFootprint(sourcePath: string, format: ResumeFootprint["format"], warning: string): ResumeFootprint {
  return resumeFootprintSchema.parse({
    sourcePath,
    format,
    status: "unavailable",
    wordCount: null,
    experienceBulletCount: null,
    currentEmployerBulletCount: null,
    targetWordMin: null,
    targetWordMax: null,
    experienceWordCount: null,
    averageExperienceBulletWords: null,
    targetExperienceWordMin: null,
    targetExperienceWordMax: null,
    warnings: [warning],
  });
}

function countWords(value: string): number {
  const plain = value.replace(/<[^>]+>/g, " ").replace(/[*_`#|]/g, " ");
  return plain.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’+./&-]*\b/gu)?.length ?? 0;
}

function experienceBullets(markdown: string): string[] {
  return professionalLines(markdown)
    .filter((line) => /^\s*[-*+]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim());
}

function firstEmployerBullets(markdown: string): string[] {
  const lines = professionalLines(markdown);
  const firstBullet = lines.findIndex((line) => /^\s*[-*+]\s+/.test(line));
  if (firstBullet < 0) return [];
  const result: string[] = [];
  for (const line of lines.slice(firstBullet)) {
    if (/^\s*[-*+]\s+/.test(line)) {
      result.push(line.replace(/^\s*[-*+]\s+/, "").trim());
      continue;
    }
    if (result.length > 0 && /^(?:\s*#{2,4}\s+|\s*\*\*[A-Z])/.test(line)) break;
  }
  return result;
}

function professionalLines(markdown: string): string[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const normalized = (line: string) => line.replace(/[*_`#]/g, "").trim().toLowerCase();
  const start = lines.findIndex((line) => normalized(line) === "professional experience");
  const end = lines.findIndex((line, index) => index > start && normalized(line) === "education");
  return start >= 0 && end > start ? lines.slice(start + 1, end) : [];
}

function sectionHtml(html: string, startLabel: string, endLabel: string): string {
  const start = html.toLowerCase().indexOf(startLabel.toLowerCase());
  const end = html.toLowerCase().indexOf(endLabel.toLowerCase(), Math.max(0, start + startLabel.length));
  return start >= 0 ? html.slice(start, end > start ? end : undefined) : html;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
}
