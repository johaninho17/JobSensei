import { BrowserWindow } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { exportedPdfSchema, type ExportedPdf, type PdfTextSize } from "../src/shared/schemas";
import { classifyApplicationArtifact, type ApplicationArtifactType } from "./application-artifacts";
import { assertInsideWorkspace } from "./workspace";
import { writeBinaryAtomic } from "./persistence";
import { readCandidateProfile } from "./candidate-profile";

const RESUME_PRINT_HEIGHT_PX = 1035;
const MAX_RESUME_OVERFLOW_RATIO = 1.12;

type ResumeFit = {
  fontSizePx: number;
  pageFillRatio: number;
  overflowRatio: number;
};

const PDF_TEXT_SCALE: Record<PdfTextSize, number> = {
  auto: 1,
  large: 1.05,
  largest: 1.1,
};

export function pdfOutputName(sourcePath: string, artifactType: ApplicationArtifactType, artifactPrefix?: string): string {
  if (artifactType === "resume") return `${artifactPrefix || basename(sourcePath, ".md").replace(/_[^_]+_Resume$/i, "") || "Candidate"}_Resume.pdf`;
  return `${basename(sourcePath, ".md")}.pdf`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inlineMarkdown(value: string): string {
  let result = escapeHtml(value);
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return result;
}

function markdownToHtml(markdown: string, artifactType: ApplicationArtifactType): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const output: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const closeList = () => { if (listType) { output.push(`</${listType}>`); listType = null; } };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) { output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`); codeLines = []; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const quote = /^\s*>\s?(.+)$/.exec(line);
    const rule = /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line);
    const plain = line.replace(/[*_`#]/g, "").trim();
    if (heading) { closeList(); output.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`); }
    else if (bullet || numbered) {
      const nextType = bullet ? "ul" : "ol";
      if (listType !== nextType) { closeList(); listType = nextType; output.push(`<${listType}>`); }
      output.push(`<li>${inlineMarkdown((bullet ?? numbered)![1])}</li>`);
    } else if (quote) { closeList(); output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); }
    else if (rule) { closeList(); output.push("<hr>"); }
    else if (!line.trim()) { closeList(); }
    else if (artifactType === "resume" && /^(?:skills(?:\s*&\s*languages)?|professional experience|education)$/i.test(plain)) {
      closeList();
      output.push(`<h2>${inlineMarkdown(line)}</h2>`);
    } else if (artifactType === "resume" && line.includes("\t")) {
      closeList();
      const [left, ...right] = line.split("\t");
      output.push(`<p class="resume-meta"><span>${inlineMarkdown(left ?? "")}</span><span>${inlineMarkdown(right.join(" ").trim())}</span></p>`);
    }
    else { closeList(); output.push(`<p>${inlineMarkdown(line)}</p>`); }
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  closeList();
  return output.join("\n");
}

function layoutCss(type: ApplicationArtifactType, textScale: number): string {
  const shared = "html{background:#fff}*{box-sizing:border-box}body{color:#171b18;margin:0}a{color:inherit;text-decoration:none}strong{font-weight:700}";
  if (type === "resume") {
    return `${shared} @page{size:Letter;margin:0}body{--resume-font-size:11.5px;--resume-line-height:1.32;--resume-section-gap:12px;--resume-heading-gap:6px;--resume-paragraph-gap:6px;--resume-list-gap:7px;--resume-bullet-gap:4px;--resume-name-scale:1.5;--resume-section-scale:1.12;--resume-meta-scale:1;font-family:Aptos,Arial,sans-serif;font-size:var(--resume-font-size);line-height:var(--resume-line-height);padding:.46in .5in}body>p:first-child{text-align:center;font-size:calc(var(--resume-font-size) * var(--resume-name-scale));letter-spacing:.04em;margin:0 0 4px}body>p:nth-child(2){text-align:center;white-space:nowrap;margin:0 0 3px}body>p:nth-child(3){text-align:center;margin:0 0 3px}body>p>strong:first-child{font-weight:700}h1{text-align:center;font-size:calc(var(--resume-font-size) * var(--resume-name-scale));letter-spacing:.04em;margin:0 0 4px}h2{font-size:calc(var(--resume-font-size) * var(--resume-section-scale));letter-spacing:.01em;border:0;margin:var(--resume-section-gap) 0 var(--resume-heading-gap);padding:0}h3{font-size:calc(var(--resume-font-size) * 1.04);margin:8px 0 1px}h4,h5,h6{font-size:var(--resume-font-size);margin:6px 0 1px}p{margin:2px 0 var(--resume-paragraph-gap)}.resume-meta{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-top:8px;font-size:calc(var(--resume-font-size) * var(--resume-meta-scale))}.resume-meta>span:first-child{min-width:0}.resume-meta>span:last-child{flex:none;text-align:right}ul,ol{margin:4px 0 var(--resume-list-gap);padding-left:20px}li{margin:0 0 var(--resume-bullet-gap)}hr{display:none}code{font-family:inherit}blockquote{margin:5px 0;padding-left:8px;border-left:2px solid #777}`;
  }
  if (type === "cover-letter") {
    return `${shared} body{font-family:Aptos,Arial,sans-serif;font-size:${12.5 * textScale}px;line-height:1.5;padding:.65in .72in}h1{font-size:${17 * textScale}px;margin:0 0 16px}h2,h3,h4,h5,h6{font-size:${12.5 * textScale}px;margin:11px 0 5px}p{margin:0 0 14px}ul,ol{margin:7px 0 12px;padding-left:21px}hr{border:0;border-top:1px solid #b7bdb8;margin:14px 0}`;
  }
  return `${shared} body{font-family:Aptos,Arial,sans-serif;font-size:${11 * textScale}px;line-height:1.45;padding:.58in}h1{font-size:${22 * textScale}px}h2{font-size:${17 * textScale}px}h3{font-size:${14 * textScale}px}p,li{font-size:${11 * textScale}px}ul,ol{padding-left:22px}pre{padding:10px;background:#f0f2ef;white-space:pre-wrap;font:${9 * textScale}px monospace}blockquote{border-left:3px solid #7a8c76;padding-left:12px;color:#4e5d50}hr{border:0;border-top:1px solid #c6ccc7}`;
}

async function pdfPageCount(pdf: Uint8Array): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(pdf) });
  const document = await loadingTask.promise;
  try { return document.numPages; }
  finally { await loadingTask.destroy(); }
}

async function fitResumeToOnePage(window: BrowserWindow, textScale: number): Promise<ResumeFit> {
  return window.webContents.executeJavaScript(`(() => {
    const body = document.body;
    if (!body) return { fontSizePx: 0, pageFillRatio: 0, overflowRatio: 0 };
    const maxHeight = ${RESUME_PRINT_HEIGHT_PX};
    const targetHeight = maxHeight * 0.965;
    // CSS pixels print at 0.75pt. A 16px ceiling therefore produces readable
    // 12pt body copy on sparse resumes instead of leaving half a page unused.
    const minSize = 10.5;
    const maxSize = 16;
    const apply = (size, spacing) => {
      body.style.setProperty('--resume-font-size', size + 'px');
      body.style.setProperty('--resume-line-height', (1.32 + spacing * 0.12).toFixed(3));
      body.style.setProperty('--resume-section-gap', (12 + spacing * 6).toFixed(2) + 'px');
      body.style.setProperty('--resume-heading-gap', (6 + spacing * 2).toFixed(2) + 'px');
      body.style.setProperty('--resume-paragraph-gap', (6 + spacing * 2.5).toFixed(2) + 'px');
      body.style.setProperty('--resume-list-gap', (7 + spacing * 2.5).toFixed(2) + 'px');
      body.style.setProperty('--resume-bullet-gap', (4 + spacing * 1.5).toFixed(2) + 'px');
      body.style.setProperty('--resume-name-scale', (1.5 + spacing * 0.1).toFixed(3));
      body.style.setProperty('--resume-section-scale', (1.12 + spacing * 0.04).toFixed(3));
      body.style.setProperty('--resume-meta-scale', (1 + spacing * 0.035).toFixed(3));
    };
    const contentHeight = () => Math.ceil(body.getBoundingClientRect().height);
    const fits = (size, spacing) => {
      apply(size, spacing);
      const contact = body.querySelector('p:nth-child(2)');
      const contactFits = !contact || contact.scrollWidth <= contact.clientWidth + 1;
      return contactFits && contentHeight() <= targetHeight;
    };
    const largestFittingFont = (spacing) => {
      let low = minSize;
      let high = maxSize;
      let best = minSize;
      for (let index = 0; index < 12; index += 1) {
        const middle = (low + high) / 2;
        if (fits(middle, spacing)) {
          best = middle;
          low = middle;
        } else high = middle;
      }
      return best;
    };
    // Prioritize readable text size, then spend remaining room on rhythm.
    const fontSize = largestFittingFont(0) * ${textScale};
    let low = 0;
    let high = 1;
    let bestSpacing = 0;
    for (let index = 0; index < 10; index += 1) {
      const middle = (low + high) / 2;
      if (fits(fontSize, middle)) {
        bestSpacing = middle;
        low = middle;
      } else high = middle;
    }
    apply(fontSize, bestSpacing);
    const renderedHeight = contentHeight();
    return {
      fontSizePx: Number(fontSize.toFixed(2)),
      pageFillRatio: Number((Math.min(renderedHeight, maxHeight) / maxHeight).toFixed(3)),
      overflowRatio: Number((renderedHeight / maxHeight).toFixed(3))
    };
  })()`);
}

export function pdfValidationStatus(
  artifactType: ApplicationArtifactType,
  pageCount: number,
  overflowRatio = 1,
): ExportedPdf["validationStatus"] {
  if (artifactType !== "resume" && artifactType !== "cover-letter") return "passed";
  if (pageCount === 1) return "passed";
  if (artifactType === "resume" && pageCount === 2 && overflowRatio <= MAX_RESUME_OVERFLOW_RATIO) return "warning";
  return "failed";
}

export async function exportMarkdownPdf(workspacePath: string, relativePath: string, textSize: PdfTextSize = "auto"): Promise<ExportedPdf> {
  const isResumeSource = relativePath.startsWith("resumes/");
  if ((!relativePath.startsWith("jobs/") && !isResumeSource) || extname(relativePath).toLowerCase() !== ".md") throw new Error("Only Markdown files inside a job workspace or resumes directory can be exported.");
  const sourcePath = assertInsideWorkspace(workspacePath, resolve(workspacePath, relativePath));
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile()) throw new Error("The selected Markdown path is not a file.");
  const parts = relative(workspacePath, sourcePath).split(sep);
  const jobId = parts[1];
  const artifactType: ApplicationArtifactType = isResumeSource ? "resume" : classifyApplicationArtifact(sourcePath);
  const profile = await readCandidateProfile(workspacePath);
  if (!isResumeSource && (!jobId || parts[0] !== "jobs")) throw new Error("Markdown file is not inside data/jobs.");
  const outputPath = isResumeSource
    ? assertInsideWorkspace(workspacePath, join(dirname(sourcePath), `${basename(sourcePath, ".md")}.pdf`))
    : assertInsideWorkspace(workspacePath, join(workspacePath, "jobs", jobId, "pdfs", pdfOutputName(sourcePath, artifactType, profile?.identity.artifactPrefix)));
  const markdown = await readFile(sourcePath, "utf8");
  const textScale = PDF_TEXT_SCALE[textSize];
  // Export is the user's approval action; workflow audits do not block it here.
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let pageCount = 0;
  let resumeFit: ResumeFit | null = null;
  let validationStatus: ExportedPdf["validationStatus"] = "passed";
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${layoutCss(artifactType, textScale)}</style></head><body>${markdownToHtml(markdown, artifactType)}</body></html>`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    if (artifactType === "resume") resumeFit = await fitResumeToOnePage(window, textScale);
    const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: "Letter", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    pageCount = await pdfPageCount(pdf);
    validationStatus = pdfValidationStatus(artifactType, pageCount, resumeFit?.overflowRatio);
    if (validationStatus === "failed") {
      throw new Error(`The ${artifactType === "resume" ? "resume" : "cover letter"} rendered to ${pageCount} pages${resumeFit ? ` (${Math.round(resumeFit.overflowRatio * 100)}% of one page)` : ""}. The existing PDF was preserved; shorten the Markdown before exporting again.`);
    }
    await writeBinaryAtomic(outputPath, pdf);
  } finally { window.destroy(); }
  return exportedPdfSchema.parse({
    relativePath: relative(workspacePath, outputPath).replaceAll("\\", "/"),
    name: basename(outputPath),
    artifactType,
    pageCount,
    pageFillRatio: resumeFit?.pageFillRatio ?? null,
    validationStatus,
  });
}
