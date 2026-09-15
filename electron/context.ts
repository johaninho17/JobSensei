import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, normalize } from "node:path";
import type { ContextManifest, ContextSelection } from "../src/shared/schemas";
type ContextSelectionInput = Partial<ContextSelection> | string[];
import { contextManifestSchema } from "../src/shared/schemas";
import { listResumePaths } from "./files";
import { listJobFolders } from "./job-folders";
import { readJson, writeJsonAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";

const CONTEXT_ROOTS = ["context/structured", "context/broad", "resumes", "cover-letters"];
const PRIMARY_CONTEXT_ROOTS = ["context/structured"];
const FALLBACK_REFERENCE_ROOTS = ["fallback-references"];
const LEGACY_FALLBACK_PATH = "context/example_evals";
const MANIFEST_PATH = ".sensei/active-context.json";
const POLICY_PATHS = ["context/denylist.md", "context/application_voice_profile.md"];

function sourceFamilyForPath(path: string): string | undefined {
  const stem = basename(path, extname(path)).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (stem.includes("linkedin")) return "linkedin-profile";
  return stem || undefined;
}

async function collectFiles(root: string, workspacePath: string, output: ContextManifest["sourceFiles"]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".DS_Store" || entry.name === ".sensei" || entry.name === "node_modules" || entry.name === "example_evals") continue;
    const path = join(root, entry.name);
    const relativeCandidate = relative(workspacePath, path).replaceAll("\\", "/");
    if (relativeCandidate.startsWith("jobs/") && (relativeCandidate.endsWith("/emails") || relativeCandidate.includes("/emails/"))) continue;
    if (entry.isDirectory()) await collectFiles(path, workspacePath, output);
    else {
      const info = await stat(path).catch(() => null);
      if (info?.isFile()) output.push({ path: relative(workspacePath, path), modifiedAt: info.mtime.toISOString(), sizeBytes: info.size });
    }
  }
}

async function collectRelativePath(workspacePath: string, relativePath: string, output: ContextManifest["sourceFiles"]): Promise<void> {
  if (relativePath === LEGACY_FALLBACK_PATH || relativePath.startsWith(`${LEGACY_FALLBACK_PATH}/`) || relativePath === FALLBACK_REFERENCE_ROOTS[0] || relativePath.startsWith(`${FALLBACK_REFERENCE_ROOTS[0]}/`)) return;
  if (relativePath.startsWith("jobs/") && (relativePath.endsWith("/emails") || relativePath.includes("/emails/"))) return;
  const path = join(workspacePath, relativePath);
  const info = await stat(path).catch(() => null);
  if (info?.isDirectory()) return collectFiles(path, workspacePath, output);
  if (info?.isFile()) output.push({ path: relative(workspacePath, path), modifiedAt: info.mtime.toISOString(), sizeBytes: info.size });
}

export async function buildContextManifest(workspacePath: string, selection: ContextSelectionInput = {}, resumeConfig: { baseResumePath?: string | null; secondaryResumePaths?: string[]; linkedinProfilePath?: string | null } = {}): Promise<ContextManifest> {
  const normalizedSelection = Array.isArray(selection) ? { jobIds: selection, careerPaths: [], structuredPaths: [], broadPaths: [], jobPaths: [] } : { jobIds: [], careerPaths: [], structuredPaths: [], broadPaths: [], jobPaths: [], ...selection };
  const jobs = await listJobFolders(workspacePath);
  const allowed = new Set(jobs.map((job) => job.id));
  const requestedJobIds = normalizedSelection.jobIds;
  const requestedJobPaths = normalizedSelection.jobPaths;
  const pathJobIds = requestedJobPaths.filter((path) => path.startsWith("jobs/")).map((path) => path.split("/")[1]).filter((id): id is string => Boolean(id));
  const selectedJobIds = [...new Set([...requestedJobIds, ...pathJobIds])].filter((id) => allowed.has(id));
  const sourceFiles: ContextManifest["sourceFiles"] = [];
  const resumePaths = await listResumePaths(workspacePath, resumeConfig.baseResumePath ?? null, resumeConfig.secondaryResumePaths ?? []);
  const configuredResumePaths = [resumePaths.baseResumePath, ...resumePaths.secondaryResumePaths].filter((path): path is string => Boolean(path));
  const hasExplicitContextSelection = normalizedSelection.structuredPaths.length > 0 || normalizedSelection.broadPaths.length > 0 || normalizedSelection.careerPaths.length > 0;
  const hasExplicitSelection = hasExplicitContextSelection || normalizedSelection.jobIds.length > 0 || normalizedSelection.jobPaths.length > 0;
  const requestedCareerPaths: string[] = hasExplicitContextSelection
    ? [...normalizedSelection.structuredPaths, ...normalizedSelection.broadPaths, ...normalizedSelection.careerPaths, ...configuredResumePaths]
    : ["context/structured", ...configuredResumePaths];
  const careerPaths = [...new Set(requestedCareerPaths.map((path) => normalize(path).replaceAll("\\", "/")))].filter((path) => !path.startsWith("..") && !path.startsWith("/"));
  for (const path of careerPaths) await collectRelativePath(workspacePath, path, sourceFiles);
  const jobPaths = normalizedSelection.jobPaths.length
    ? normalizedSelection.jobPaths
    : selectedJobIds.map((id) => `jobs/${id}`);
  for (const path of [...new Set(jobPaths.map((value) => normalize(value).replaceAll("\\", "/")))]) {
    if (path.startsWith("jobs/") && !path.startsWith("jobs/../")) await collectRelativePath(workspacePath, path, sourceFiles);
  }
  for (const source of sourceFiles) source.sourceFamily = sourceFamilyForPath(source.path);
  const selectedCareerPaths = sourceFiles.filter((source) => !source.path.startsWith("jobs/")).map((source) => source.path);
  const selectedStructuredPaths = selectedCareerPaths.filter((path) => path.startsWith("context/structured/"));
  const selectedBroadPaths = selectedCareerPaths.filter((path) => path.startsWith("context/broad/"));
  const selectedJobFiles = sourceFiles.filter((source) => source.path.startsWith("jobs/")).map((source) => source.path);
  const linkedinProfilePath = resumeConfig.linkedinProfilePath && selectedCareerPaths.includes(resumeConfig.linkedinProfilePath) ? resumeConfig.linkedinProfilePath : null;
  const manifest = contextManifestSchema.parse({
    schemaVersion: 1,
    workspacePath,
    baseResumePath: resumePaths.baseResumePath,
    secondaryResumePaths: resumePaths.secondaryResumePaths,
    linkedinProfilePath,
    contextRoots: CONTEXT_ROOTS,
    fallbackReferenceRoots: FALLBACK_REFERENCE_ROOTS,
    policyPaths: POLICY_PATHS,
    primaryContextRoots: PRIMARY_CONTEXT_ROOTS,
    conditionalContextRoots: [],
    selectedJobIds,
    selectedJobPaths: [...new Set(selectedJobFiles.map((path) => path.split("/").slice(0, 2).join("/")))],
    selectedCareerPaths,
    selectedStructuredPaths,
    selectedBroadPaths,
    selectedJobFiles,
    selectionMode: hasExplicitSelection ? "explicit" : "default",
    scope: selectedJobIds.length ? "selected-jobs" : "career-context",
    sourceFiles: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)),
    generatedAt: new Date().toISOString(),
    instructions: `Use only the selected files in this manifest. Selected structured context: ${selectedStructuredPaths.join(", ") || "none"}. Selected broad context: ${selectedBroadPaths.join(", ") || "none"}. Do not read unselected files or count related source families as independent evidence. Employer-context describes company scale only and cannot support candidate claims. Always enforce ${POLICY_PATHS.join(", ")} as policy. The configured base resume (${resumePaths.baseResumePath ?? "missing"}) controls identity, chronology, structure, and presentation; selected structured evidence controls factual claims. Secondary resumes and LinkedIn are lower-weight historical or corroboration sources. Missing evidence is a gap, never permission to invent or reuse conversation memory. Job evidence is limited to selected files.`,
  });
  await writeJsonAtomic(join(workspacePath, MANIFEST_PATH), manifest);
  return manifest;
}

export function contextManifestPath(workspacePath: string): string {
  return assertInsideWorkspace(workspacePath, join(workspacePath, MANIFEST_PATH));
}

export async function readActiveContextManifest(workspacePath: string): Promise<ContextManifest | null> {
  const value = await readJson<unknown>(contextManifestPath(workspacePath));
  const parsed = contextManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function contextSources(): string[] {
  return [...CONTEXT_ROOTS];
}
