import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import mammoth from "mammoth";
import { resumeFootprintSchema, type ResumeFootprint } from "../src/shared/schemas";
import { assertInsideWorkspace } from "./workspace";
import { experienceBulletLines, mammothHtmlToMarkdown } from "./resume-sections";

const MIN_FOOTPRINT_RATIO = 0.9;
const MAX_FOOTPRINT_RATIO = 1.15;
const MIN_EXPERIENCE_RATIO = 0.85;
const MAX_EXPERIENCE_RATIO = 1.15;

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
  // Experience is found exactly as the parser finds it (resume-sections.ts), whatever the heading is called.
  const { all: bullets, firstEmployer: currentEmployerBullets } = experienceBulletLines(markdown);
  const experienceWordCount = countWords(bullets.join(" "));
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
  // The same Markdown the parser reads, so Experience is found the same way for Word files.
  const { all: bullets, firstEmployer } = experienceBulletLines(mammothHtmlToMarkdown(html.value));
  const experienceWordCount = countWords(bullets.join(" "));
  const experienceBulletCount = bullets.length || null;
  const currentEmployerBulletCount = firstEmployer.length || null;
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





