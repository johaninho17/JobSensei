import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import {
  searchQuerySchema,
  searchResponseSchema,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
  type SearchResultKind,
} from "../src/shared/schemas";
import { assertInsideWorkspace } from "./workspace";

const SEARCH_ROOTS = ["context", "resumes", "cover-letters", "debrief", "jobs"];
const IGNORED_NAMES = new Set([".DS_Store", ".sensei", "node_modules", "fallback-references", "example_evals"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".rtf", ".csv", ".log"]);
const MAX_INDEX_FILES = 2500;
const MAX_SEARCH_BYTES = 512 * 1024;
const CACHE_TTL_MS = 10_000;

type SearchDocument = Omit<SearchResult, "score" | "excerpt"> & {
  searchableTitle: string;
  searchableMetadata: string;
  searchableContent: string;
  content: string;
};

const indexCache = new Map<string, { builtAt: number; documents: SearchDocument[] }>();

function clean(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function displayName(path: string): string {
  const name = basename(path, extname(path)).replaceAll(/[_-]+/g, " ").trim();
  return name.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fileKind(relativePath: string): SearchResultKind {
  if (!relativePath.startsWith("jobs/")) return "career";
  if (/\/interviews\/|question|mock|challenge|debrief/i.test(relativePath)) return "interview";
  return "application";
}

async function jobMetadata(jobRoot: string): Promise<{ company: string | null; title: string | null }> {
  for (const path of [join(jobRoot, ".sensei", "job.json"), join(jobRoot, "job.json")]) {
    try {
      const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      return {
        company: typeof record.company === "string" && record.company.trim() ? record.company.trim() : null,
        title: typeof record.title === "string" && record.title.trim()
          ? record.title.trim()
          : typeof record.role === "string" && record.role.trim() ? record.role.trim() : null,
      };
    } catch {
      // Hidden metadata is preferred; legacy root metadata remains readable.
    }
  }
  return { company: null, title: null };
}

async function preferredJobArtifact(jobRoot: string, jobId: string): Promise<string | null> {
  const entries = await readdir(jobRoot, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.filter((entry) => entry.isFile() && !entry.name.startsWith(".")).map((entry) => entry.name));
  for (const name of ["evaluation.md", "original_jd.md", "original_jd.txt", "cover_letter.md"]) {
    if (names.has(name)) return `jobs/${jobId}/${name}`;
  }
  const fallback = [...names].sort().find((name) => TEXT_EXTENSIONS.has(extname(name).toLowerCase()) || [".pdf", ".docx"].includes(extname(name).toLowerCase()));
  return fallback ? `jobs/${jobId}/${fallback}` : null;
}

async function indexDirectory(workspacePath: string, path: string, documents: SearchDocument[], inheritedJob: { id: string; company: string | null; title: string | null } | null): Promise<void> {
  if (documents.length >= MAX_INDEX_FILES) return;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const hasMarkdownJobDescription = entries.some((entry) => entry.isFile() && entry.name === "original_jd.md");
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (documents.length >= MAX_INDEX_FILES) return;
    if (entry.name.startsWith(".") || IGNORED_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
    if (entry.name === "original_jd.txt" && hasMarkdownJobDescription) continue;
    const child = assertInsideWorkspace(workspacePath, join(path, entry.name));
    if (entry.isDirectory()) {
      await indexDirectory(workspacePath, child, documents, inheritedJob);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = relative(workspacePath, child).replaceAll("\\", "/");
    const info = await stat(child).catch(() => null);
    if (!info?.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    const content = TEXT_EXTENSIONS.has(extension) && info.size <= MAX_SEARCH_BYTES
      ? await readFile(child, "utf8").catch(() => "")
      : "";
    const kind = fileKind(relativePath);
    const title = displayName(entry.name);
    const subtitle = inheritedJob
      ? [inheritedJob.company, inheritedJob.title].filter(Boolean).join(" · ") || inheritedJob.id
      : relativePath.split("/").slice(0, -1).join("/");
    documents.push({
      id: `file:${relativePath}`,
      kind,
      title,
      subtitle: subtitle || null,
      relativePath,
      jobId: inheritedJob?.id ?? null,
      company: inheritedJob?.company ?? null,
      searchableTitle: clean(`${title} ${entry.name}`),
      searchableMetadata: clean(`${relativePath} ${subtitle}`),
      searchableContent: clean(content),
      content: content.replaceAll(/\s+/g, " ").trim(),
    });
  }
}

async function buildIndex(workspacePath: string): Promise<SearchDocument[]> {
  const documents: SearchDocument[] = [];
  for (const rootName of SEARCH_ROOTS) {
    const root = assertInsideWorkspace(workspacePath, join(workspacePath, rootName));
    const rootInfo = await stat(root).catch(() => null);
    if (!rootInfo?.isDirectory()) continue;
    if (rootName !== "jobs") {
      await indexDirectory(workspacePath, root, documents, null);
      continue;
    }
    const jobs = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of jobs.filter((item) => item.isDirectory() && !item.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
      const jobRoot = assertInsideWorkspace(workspacePath, join(root, entry.name));
      const metadata = await jobMetadata(jobRoot);
      const preferredPath = await preferredJobArtifact(jobRoot, entry.name);
      const title = metadata.company ?? entry.name.replaceAll(/[_-]+/g, " ");
      const subtitle = metadata.title;
      documents.push({
        id: `job:${entry.name}`,
        kind: "job",
        title,
        subtitle,
        relativePath: preferredPath,
        jobId: entry.name,
        company: metadata.company,
        searchableTitle: clean(`${title} ${metadata.title ?? ""}`),
        searchableMetadata: clean(entry.name),
        searchableContent: "",
        content: "",
      });
      await indexDirectory(workspacePath, jobRoot, documents, { id: entry.name, company: metadata.company, title: metadata.title });
    }
  }
  return documents;
}

function excerpt(content: string, tokens: string[]): string | null {
  if (!content) return null;
  const lowered = content.toLowerCase();
  const positions = tokens.map((token) => lowered.indexOf(token)).filter((position) => position >= 0);
  if (!positions.length) return null;
  const start = Math.max(0, Math.min(...positions) - 52);
  const end = Math.min(content.length, start + 170);
  return `${start > 0 ? "…" : ""}${content.slice(start, end).trim()}${end < content.length ? "…" : ""}`;
}

function match(document: SearchDocument, tokens: string[]): SearchResult | null {
  const haystack = `${document.searchableTitle} ${document.searchableMetadata} ${document.searchableContent}`;
  if (!tokens.every((token) => haystack.includes(token))) return null;
  let score = document.kind === "job" ? 8 : 0;
  for (const token of tokens) {
    if (document.searchableTitle.includes(token)) score += 40;
    if (document.searchableMetadata.includes(token)) score += 20;
    if (document.searchableContent.includes(token)) score += 6;
  }
  return {
    id: document.id,
    kind: document.kind,
    title: document.title,
    subtitle: document.subtitle,
    relativePath: document.relativePath,
    jobId: document.jobId,
    company: document.company,
    excerpt: excerpt(document.content, tokens),
    score,
  };
}

export function invalidateSearchIndex(workspacePath?: string): void {
  if (workspacePath) indexCache.delete(workspacePath);
  else indexCache.clear();
}

export async function searchWorkspace(workspacePath: string, input: SearchQuery): Promise<SearchResponse> {
  const query = searchQuerySchema.parse(input);
  const cached = indexCache.get(workspacePath);
  const documents = cached && Date.now() - cached.builtAt < CACHE_TTL_MS
    ? cached.documents
    : await buildIndex(workspacePath);
  if (!cached || cached.documents !== documents) indexCache.set(workspacePath, { builtAt: Date.now(), documents });
  const tokens = clean(query.query).split(" ").filter(Boolean);
  const results = documents
    .flatMap((document) => {
      const result = match(document, tokens);
      return result ? [result] : [];
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, query.limit);
  return searchResponseSchema.parse({ query: query.query, results });
}
