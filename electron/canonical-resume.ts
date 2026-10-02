import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import mammoth from "mammoth";
import {
  canonicalResumeBaselineSchema,
  type ApplicationDraft,
  type CanonicalResumeBaseline,
  type CanonicalResumeEmployer,
  type ResumeFootprint,
} from "../src/shared/schemas";
import { profileBaseResume } from "./resume-footprint";
import { assertInsideWorkspace } from "./workspace";

export type CanonicalDriftCode =
  | "HEADER_DRIFT"
  | "CONTACT_DRIFT"
  | "SECTION_STRUCTURE_DRIFT"
  | "EMPLOYMENT_TITLE_DRIFT"
  | "EMPLOYMENT_DATE_DRIFT"
  | "EMPLOYMENT_LOCATION_DRIFT"
  | "EMPLOYMENT_METADATA_DRIFT"
  | "EDUCATION_DRIFT";

export interface CanonicalDrift {
  code: CanonicalDriftCode;
  field: string;
  expected: string;
  actual: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function displayText(value: string): string {
  return value
    .replace(/\\([\\().,+-])/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalized(value: string): string {
  return displayText(value).replace(/[–—]/g, "-").toLowerCase();
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

function sanitizeHeaderLines(lines: string[]): string[] {
  const result = [...lines];
  if (result.length >= 2) {
    const first = result[0] ?? "";
    const second = result[1] ?? "";
    if (first.startsWith("**") && !first.endsWith("**") && second.startsWith("**")) {
      result[0] = `${first}**`;
      result[1] = second.replace(/^\*\*\s*/, "").trim();
    }
  }
  return result;
}

function mammothHtmlToMarkdown(html: string): string {
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

function isHeading(line: string, label: RegExp): boolean {
  return label.test(displayText(line));
}

function firstStrongText(line: string): string | null {
  const match = /\*\*([^*]+)\*\*|__([^_]+)__/.exec(line);
  return displayText(match?.[1] ?? match?.[2] ?? "") || null;
}

function dateRange(value: string): string | null {
  const match = /(?:\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+|\b\d{1,2}\/)?\d{4}\s*(?:-|–|—|\\-)\s*(?:Present|(?:\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+|\d{1,2}\/)?\d{4})/i.exec(displayText(value));
  return match?.[0] ?? null;
}

function employerMetadata(lines: string[], name: string): Pick<CanonicalResumeEmployer, "title" | "dateRange" | "location"> {
  const text = displayText(lines.join(" "));
  const dates = dateRange(text);
  const dateIndex = dates ? text.toLowerCase().indexOf(dates.toLowerCase()) : -1;
  const afterName = text.slice(Math.max(0, text.toLowerCase().indexOf(name.toLowerCase()) + name.length)).trim();
  const titlePart = (dateIndex >= 0 ? text.slice(0, dateIndex) : afterName)
    .replace(name, "")
    .replace(/^[\s|,—-]+|[\s|,—-]+$/g, "")
    .trim();
  const afterDate = dateIndex >= 0 ? text.slice(dateIndex + (dates?.length ?? 0)) : "";
  const location = afterDate.replace(/^[\s|,—-]+/, "").trim() || null;
  return { title: titlePart || null, dateRange: dates, location };
}

function parseCanonicalMarkdown(
  markdown: string,
  sourcePath: string,
  sourceSha256: string,
  structureSource: "markdown" | "docx",
  footprint: ResumeFootprint,
  warnings: string[],
): CanonicalResumeBaseline {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const skillsIndex = lines.findIndex((line) => isHeading(line, /^skills(?:\s*[-–—&]\s*languages)?$/i));
  const professionalIndex = lines.findIndex((line) => isHeading(line, /^professional experience$/i));
  const educationIndex = lines.findIndex((line) => isHeading(line, /^education$/i));
  if (skillsIndex < 0 || professionalIndex <= skillsIndex || educationIndex <= professionalIndex) {
    throw new Error("The configured base resume does not expose the required Skills, Professional Experience, and Education structure.");
  }

  const rawHeaderLines = lines.slice(0, skillsIndex).map((line) => line.trim()).filter(Boolean);
  const headerLines = sanitizeHeaderLines(rawHeaderLines);
  const originalSkillsLines = lines.slice(skillsIndex + 1, professionalIndex).map((line) => line.trim()).filter(Boolean);
  const professionalLines = lines.slice(professionalIndex + 1, educationIndex);
  const employers: CanonicalResumeEmployer[] = [];
  let protectedLines: string[] = [];
  let originalBullets: string[] = [];
  const finishEmployer = () => {
    if (!protectedLines.length) return;
    const name = firstStrongText(protectedLines[0] ?? "") ?? displayText(protectedLines[0] ?? "").split(/\s+[|—-]\s+/)[0]?.trim();
    if (!name) throw new Error("A base-resume employer heading could not be parsed.");
    employers.push({
      name,
      protectedLines,
      ...employerMetadata(protectedLines, name),
      originalBulletCount: originalBullets.length,
      originalBullets,
    });
    protectedLines = [];
    originalBullets = [];
  };

  for (const rawLine of professionalLines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[-*+]\s+/.test(line)) {
      originalBullets.push(line.replace(/^[-*+]\s+/, "").trim());
      continue;
    }
    if (originalBullets.length > 0) finishEmployer();
    protectedLines.push(line);
  }
  finishEmployer();
  if (!employers.length) throw new Error("No employer blocks were found in the configured base resume.");

  const educationLines = lines.slice(educationIndex + 1).map((line) => line.trim()).filter(Boolean);
  const core = {
    schemaVersion: 1 as const,
    sourcePath,
    sourceSha256,
    structureSource,
    headerLines,
    skillsHeadingLine: lines[skillsIndex]!.trim(),
    professionalHeadingLine: lines[professionalIndex]!.trim(),
    employers,
    educationHeadingLine: lines[educationIndex]!.trim(),
    educationLines,
    originalSkillsLines,
    footprint,
    warnings,
  };
  return canonicalResumeBaselineSchema.parse({ ...core, baselineId: sha256(JSON.stringify(core)) });
}

export async function loadCanonicalResumeBaseline(workspacePath: string, relativePath: string): Promise<CanonicalResumeBaseline> {
  const sourcePath = assertInsideWorkspace(workspacePath, resolve(workspacePath, relativePath));
  const source = await readFile(sourcePath);
  const extension = extname(relativePath).toLowerCase();
  const footprint = await profileBaseResume(workspacePath, relativePath);
  if (extension === ".md") {
    return parseCanonicalMarkdown(source.toString("utf8"), relativePath, sha256(source), "markdown", footprint, []);
  }
  if (extension === ".docx") {
    const converted = await mammoth.convertToHtml({ buffer: source });
    return parseCanonicalMarkdown(
      mammothHtmlToMarkdown(converted.value),
      relativePath,
      sha256(source),
      "docx",
      footprint,
      converted.messages.map((message) => message.message),
    );
  }
  if (extension === ".pdf") {
    const stripped = relativePath.slice(0, -extname(relativePath).length);
    const candidates = [
      stripped,
      ...[".docx", ".md"].map((altExt) => stripped + altExt),
    ];
    for (const companionRelative of candidates) {
      if (!companionRelative.endsWith(".docx") && !companionRelative.endsWith(".md")) {
        continue;
      }
      try {
        const companionPath = assertInsideWorkspace(workspacePath, resolve(workspacePath, companionRelative));
        const info = await stat(companionPath).catch(() => null);
        if (info?.isFile()) {
          const companionBaseline = await loadCanonicalResumeBaseline(workspacePath, companionRelative);
          const { baselineId: _ignored, ...coreWithoutId } = {
            ...companionBaseline,
            sourcePath: relativePath,
            sourceSha256: sha256(source),
            footprint,
          };
          return canonicalResumeBaselineSchema.parse({
            ...coreWithoutId,
            baselineId: sha256(JSON.stringify(coreWithoutId)),
          });
        }
      } catch {
        // continue trying next companionRelative
      }
    }
  }
  throw new Error("Protected resume baselines currently require a Markdown or DOCX base resume.");
}

export function composeCanonicalResume(baseline: CanonicalResumeBaseline, draft: ApplicationDraft["resume"]): string {
  const draftEmployers = new Map(draft.employers.map((employer) => [normalized(employer.name), employer]));
  const baselineNames = baseline.employers.map((employer) => normalized(employer.name));
  if (draftEmployers.size !== baseline.employers.length || [...draftEmployers.keys()].some((name) => !baselineNames.includes(name))) {
    throw new Error("The resume draft must provide bullets for exactly the employers in the canonical base resume.");
  }
  const isLanguagesLine = (line: string) => /^languages\s*:/i.test(line.replace(/[*_`]/g, "").trim());
  const canonicalLanguagesLine = baseline.originalSkillsLines.find(isLanguagesLine);
  const tailoredSkillsLines = draft.skillsLines.filter((line) => !isLanguagesLine(line));
  const composedSkillsLines = canonicalLanguagesLine ? [...tailoredSkillsLines, canonicalLanguagesLine] : tailoredSkillsLines;
  const header = sanitizeHeaderLines(baseline.headerLines).join("\n");
  const sections = [
    header,
    baseline.skillsHeadingLine,
    composedSkillsLines.join("\n"),
    baseline.professionalHeadingLine,
    ...baseline.employers.map((employer) => {
      const selected = draftEmployers.get(normalized(employer.name));
      if (!selected) throw new Error(`The resume draft is missing bullets for ${employer.name}.`);
      return `${employer.protectedLines.join("\n")}\n${selected.bullets.map((bullet) => `- ${bullet.replace(/^[-*+]\s+/, "").trim()}`).join("\n")}`;
    }),
    baseline.educationHeadingLine,
    baseline.educationLines.join("\n"),
  ];
  return `${sections.join("\n\n")}\n`;
}

export function composeCanonicalCoverLetter(baseline: CanonicalResumeBaseline, draft: ApplicationDraft["coverLetter"]): string {
  const header = sanitizeHeaderLines(baseline.headerLines);
  return `${[
    header.join("\n"),
    draft.date,
    draft.recipientLines.join("\n"),
    draft.salutation,
    ...draft.bodyParagraphs,
    `${draft.closing}\n${displayText(header[0] ?? "")}`,
  ].join("\n\n")}\n`;
}

export function canonicalResumeDrifts(markdown: string, baseline: CanonicalResumeBaseline): CanonicalDrift[] {
  let candidate: CanonicalResumeBaseline;
  try {
    candidate = parseCanonicalMarkdown(
      markdown,
      baseline.sourcePath,
      baseline.sourceSha256,
      baseline.structureSource,
      baseline.footprint,
      [],
    );
  } catch (error) {
    return [{
      code: "SECTION_STRUCTURE_DRIFT",
      field: "sections",
      expected: "Skills, Professional Experience, and Education in canonical order",
      actual: error instanceof Error ? error.message : String(error),
    }];
  }
  const drifts: CanonicalDrift[] = [];
  const expectedHeader = baseline.headerLines.map(displayText);
  const actualHeader = candidate.headerLines.map(displayText);
  if (expectedHeader[0] !== actualHeader[0]) {
    drifts.push({ code: "HEADER_DRIFT", field: "candidateName", expected: expectedHeader[0] ?? "", actual: actualHeader[0] ?? "" });
  }
  if (JSON.stringify(expectedHeader.slice(1)) !== JSON.stringify(actualHeader.slice(1))) {
    drifts.push({ code: "CONTACT_DRIFT", field: "contact", expected: expectedHeader.slice(1).join(" | "), actual: actualHeader.slice(1).join(" | ") });
  }
  if (displayText(baseline.skillsHeadingLine) !== displayText(candidate.skillsHeadingLine)
    || displayText(baseline.professionalHeadingLine) !== displayText(candidate.professionalHeadingLine)
    || displayText(baseline.educationHeadingLine) !== displayText(candidate.educationHeadingLine)
    || baseline.employers.length !== candidate.employers.length) {
    drifts.push({ code: "SECTION_STRUCTURE_DRIFT", field: "sections", expected: "Canonical section and employer order", actual: "Changed section or employer structure" });
  }
  baseline.employers.forEach((expected, index) => {
    const actual = candidate.employers[index];
    if (!actual || normalized(expected.name) !== normalized(actual.name)) {
      drifts.push({ code: "EMPLOYMENT_METADATA_DRIFT", field: `employers[${index}]`, expected: expected.name, actual: actual?.name ?? "missing" });
      return;
    }
    for (const [field, code] of [
      ["title", "EMPLOYMENT_TITLE_DRIFT"],
      ["dateRange", "EMPLOYMENT_DATE_DRIFT"],
      ["location", "EMPLOYMENT_LOCATION_DRIFT"],
    ] as const) {
      if (normalized(expected[field] ?? "") !== normalized(actual[field] ?? "")) {
        drifts.push({ code, field: `${expected.name}.${field}`, expected: expected[field] ?? "", actual: actual[field] ?? "" });
      }
    }
    if (expected.protectedLines.map(displayText).join("\n") !== actual.protectedLines.map(displayText).join("\n")
      && !drifts.some((drift) => drift.field.startsWith(`${expected.name}.`))) {
      drifts.push({
        code: "EMPLOYMENT_METADATA_DRIFT",
        field: `${expected.name}.metadata`,
        expected: expected.protectedLines.map(displayText).join(" | "),
        actual: actual.protectedLines.map(displayText).join(" | "),
      });
    }
  });
  if (baseline.educationLines.map(displayText).join("\n") !== candidate.educationLines.map(displayText).join("\n")) {
    drifts.push({
      code: "EDUCATION_DRIFT",
      field: "education",
      expected: baseline.educationLines.map(displayText).join(" | "),
      actual: candidate.educationLines.map(displayText).join(" | "),
    });
  }
  return drifts;
}

export function canonicalCoverLetterDrifts(markdown: string, baseline: CanonicalResumeBaseline): CanonicalDrift[] {
  const greetingIndex = markdown.split(/\r?\n/).findIndex((line) => /^(?:Dear|Hello)\b/i.test(displayText(line)));
  const headerLines = markdown.split(/\r?\n/).slice(0, greetingIndex < 0 ? 0 : greetingIndex).map((line) => line.trim()).filter(Boolean);
  const expected = baseline.headerLines.map(displayText);
  const actual = headerLines.slice(0, baseline.headerLines.length).map(displayText);
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
  return [{ code: "CONTACT_DRIFT", field: "coverLetter.contact", expected: expected.join(" | "), actual: actual.join(" | ") }];
}
