// Posting library (Recruiter Edition, plan R5): a posting is fetched and cleaned once at the recruiter level, then
// copied into each chosen candidate's own folder and queue. Agy only ever reads the copy inside the candidate's
// folder, so a run never reaches another candidate's files.
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { writeJsonAtomic } from "./persistence";
import { join } from "node:path";
import { matchCandidate, type CandidateSuggestion, type ExistingPosting, type LibraryEntry, type LibraryPosting, type PostingSend } from "../src/shared/candidate-match";
import { RECRUITER_DIR } from "../src/shared/candidates";
import { newQueueItem } from "../src/shared/job-queue";
import { EMPTY_CANDIDATE_TARGETS, candidateProfileSchema, type CandidateTargets } from "../src/shared/schemas";
import { candidatePath, readRoster } from "./candidates";
import { STAGED_JDS_DIR, setStagedCompany, stageLinkJobDescription, stagePastedJobDescription } from "./jd-fetch";
import { readJobQueue, saveJobQueue } from "./job-queue";
import { postingRecordFor } from "./posting-record";
import { addProposal, readProposals } from "./proposals";
import { loadCanonicalResumeBaseline } from "./canonical-resume";

/** The library is laid out like a workspace, so the posting cleanup and staging code run on it unchanged. */
export const libraryPath = (root: string) => join(root, RECRUITER_DIR, "library");
const POSTING_ID = /^paste-[a-z0-9-]{4,40}$/;
const checkId = (id: string) => { if (!POSTING_ID.test(id)) throw new Error("That is not a valid posting ID."); return id; };
const stagedFile = (workspace: string, id: string, ext: string) => join(workspace, ...STAGED_JDS_DIR.split("/"), `${id}${ext}`);
const exists = (path: string) => stat(path).then(() => true, () => false);


function postingLabel(meta: { company?: string | null; title?: string | null; url?: string | null }): string | null {
  return [meta.company, meta.title].filter(Boolean).join(", ") || meta.url || null;
}

async function libraryMeta(root: string, id: string): Promise<LibraryPosting> {
  const meta = JSON.parse(await readFile(stagedFile(libraryPath(root), checkId(id), ".json"), "utf8")) as Partial<LibraryPosting>;
  return { id, title: meta.title ?? null, company: meta.company ?? null, location: meta.location ?? null, url: meta.url && meta.url !== "pasted" ? meta.url : null };
}

export async function stageLibraryLink(root: string, url: string, id: string, fetcher: typeof fetch = fetch): Promise<LibraryPosting> {
  await stageLinkJobDescription(libraryPath(root), url, checkId(id), fetcher);
  return libraryMeta(root, id);
}

export async function stageLibraryPaste(root: string, text: unknown, id: string): Promise<LibraryPosting> {
  await stagePastedJobDescription(libraryPath(root), text, checkId(id));
  return libraryMeta(root, id);
}

export async function setLibraryCompany(root: string, id: string, company: string): Promise<LibraryPosting> {
  await setStagedCompany(libraryPath(root), checkId(id), company);
  return libraryMeta(root, id);
}

/** Every posting a candidate already has: their jobs (from each job's posting record) and their waiting queue items. */
async function existingPostings(folder: string): Promise<ExistingPosting[]> {
  const jobs = await readdir(join(folder, "jobs"), { withFileTypes: true }).catch(() => []);
  const fromJobs = await Promise.all(jobs.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const record = await readFile(join(folder, "jobs", entry.name, ".sensei", "posting.json"), "utf8").then((raw) => JSON.parse(raw) as { url?: string | null; company?: string | null; title?: string | null }, () => null);
    return { jobId: entry.name, url: record?.url ?? null, company: record?.company ?? null, title: record?.title ?? null };
  }));
  const queue = await readJobQueue(folder);
  const waiting = await Promise.all(queue.items.filter((item) => item.status === "queued" || item.status === "running").map(async (item) => {
    const meta = await readFile(stagedFile(folder, item.id, ".json"), "utf8").then((raw) => JSON.parse(raw) as { url?: string; company?: string | null; title?: string | null }, () => null);
    return { jobId: null, url: item.url ?? (meta?.url && meta.url !== "pasted" ? meta.url : null), company: meta?.company ?? null, title: meta?.title ?? null };
  }));
  const proposals = (await readProposals(folder)).map((proposal) => ({ jobId: null, url: proposal.url, company: proposal.company, title: proposal.title }));
  return [...fromJobs, ...waiting, ...proposals];
}

async function candidateTargets(folder: string): Promise<CandidateTargets> {
  const raw = await readFile(join(folder, "profile", "candidate.json"), "utf8").then((text) => JSON.parse(text) as unknown, () => null);
  const parsed = candidateProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data.preferences.targets : EMPTY_CANDIDATE_TARGETS;
}

/** The employer the base resume lists as present (e.g. "2023 - Present"), or null. */
async function currentEmployer(folder: string, baseResumePath: string | null): Promise<string | null> {
  if (!baseResumePath) return null;
  const baseline = await loadCanonicalResumeBaseline(folder, baseResumePath).catch(() => null);
  const first = baseline?.employers[0];
  return first && /present|current|now/i.test(first.dateRange ?? "") ? first.name : null;
}

/** Every candidate who isn't archived, best match first, each with its reasons. */
export async function suggestCandidates(root: string, id: string): Promise<CandidateSuggestion[]> {
  const markdown = await readFile(stagedFile(libraryPath(root), checkId(id), ".md"), "utf8");
  const meta = await libraryMeta(root, id);
  const record = postingRecordFor(markdown);
  const posting = { ...record, title: meta.title ?? record.title, company: meta.company ?? record.company, location: meta.location ?? record.location, url: meta.url ?? record.url };
  const roster = await readRoster(root);
  const rows = await Promise.all(roster.candidates.filter((candidate) => candidate.status !== "archived").map(async (candidate) => {
    const folder = await candidatePath(root, candidate.id);
    const [targets, existing, settings] = await Promise.all([candidateTargets(folder), existingPostings(folder), readFile(join(folder, ".sensei", "app", "settings.json"), "utf8").then((raw) => JSON.parse(raw) as { baseResumePath?: string | null }, () => null)]);
    const match = matchCandidate(posting, targets, existing, await currentEmployer(folder, settings?.baseResumePath ?? null));
    // A candidate without a base resume can't be tailored for yet; say so instead of queuing a run that would fail.
    if (!settings?.baseResumePath) {
      const blocker = "No base resume yet (open them, then Setup)";
      return { id: candidate.id, name: candidate.displayName, status: candidate.status, ...match, suggested: false, blocker: match.blocker ?? blocker, reasons: [{ good: false, text: blocker }, ...match.reasons] };
    }
    return { id: candidate.id, name: candidate.displayName, status: candidate.status, ...match };
  }));
  return rows.sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Copies the posting into each chosen candidate's folder under a new paste ID and adds it to their queue. The open
 * candidate's queue belongs to the window (it saves the whole queue), so their item is returned for the window to
 * add instead of being written here.
 */
export async function sendPosting(root: string, id: string, candidateIds: string[], activeId: string | null, now = new Date()): Promise<{ active: { pasteId: string; label: string | null } | null; queued: string[]; proposed: string[] }> {
  const library = libraryPath(root);
  const meta = await libraryMeta(root, checkId(id));
  const roster = await readRoster(root);
  let active: { pasteId: string; label: string | null } | null = null;
  const queued: string[] = [];
  const proposed: string[] = [];
  let suggestions: CandidateSuggestion[] | null = null;
  for (const candidateId of [...new Set(candidateIds)]) {
    const entry = roster.candidates.find((candidate) => candidate.id === candidateId);
    if (!entry || entry.status === "archived") continue;
    const folder = await candidatePath(root, candidateId);
    // A candidate who approves jobs first gets a proposal, not a queue item (recruiter plan R8 P5).
    if ((await candidateTargets(folder)).approval) {
      suggestions ??= await suggestCandidates(root, id);
      const reasons = suggestions.find((row) => row.id === candidateId)?.reasons.filter((reason) => reason.good).map((reason) => reason.text) ?? [];
      await addProposal(folder, join(library, ...STAGED_JDS_DIR.split("/")), id, { company: meta.company, title: meta.title, url: meta.url, reasons }, now);
      proposed.push(candidateId);
      continue;
    }
    const item = newQueueItem({ kind: "paste", label: postingLabel(meta) }, now, false);
    if (meta.url) item.url = meta.url;
    for (const ext of [".md", ".json", ".form.md"]) {
      const source = stagedFile(library, id, ext);
      if (await exists(source)) {
        const target = stagedFile(folder, item.id, ext);
        await mkdir(join(target, ".."), { recursive: true });
        await copyFile(source, target);
      }
    }
    if (candidateId === activeId) { active = { pasteId: item.id, label: item.label }; continue; }
    const queue = await readJobQueue(folder);
    await saveJobQueue(folder, { ...queue, items: [...queue.items.filter((existing) => existing.status !== "done").slice(-49), item] });
    queued.push(candidateId);
  }
  const at = now.toISOString();
  const sends: PostingSend[] = [
    ...[...(active && activeId ? [activeId] : []), ...queued].map((candidateId): PostingSend => ({ candidateId, kind: "queued", at })),
    ...proposed.map((candidateId): PostingSend => ({ candidateId, kind: "proposed", at })),
  ];
  await recordSends(root, id, sends);
  return { active, queued, proposed };
}

/** Notes who a posting went to in its library record (plan Q4), so the Postings page can show it. */
async function recordSends(root: string, id: string, sends: PostingSend[]): Promise<void> {
  if (!sends.length) return;
  const path = stagedFile(libraryPath(root), checkId(id), ".json");
  const meta = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> & { sentTo?: PostingSend[] };
  await writeJsonAtomic(path, { ...meta, sentTo: [...(meta.sentTo ?? []), ...sends] });
}

/** Every posting in the library, newest first, with who it went to (plan Q4). */
export async function listLibrary(root: string): Promise<LibraryEntry[]> {
  const dir = join(libraryPath(root), ...STAGED_JDS_DIR.split("/"));
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => POSTING_ID.test(name.replace(/\.json$/, "")) && name.endsWith(".json") && !name.endsWith(".form.json"));
  const roster = await readRoster(root);
  const nameOf = new Map(roster.candidates.map((candidate) => [candidate.id, candidate.displayName]));
  const entries = await Promise.all(names.map(async (name) => {
    const id = name.replace(/\.json$/, "");
    const [meta, raw, added] = await Promise.all([libraryMeta(root, id).catch(() => null), readFile(join(dir, name), "utf8").then((text) => JSON.parse(text) as { sentTo?: PostingSend[] }, () => null), stat(join(dir, `${id}.md`)).catch(() => null)]);
    if (!meta) return null;
    const sentTo = (raw?.sentTo ?? []).filter((send) => nameOf.has(send.candidateId)).map((send) => ({ ...send, name: nameOf.get(send.candidateId)! }));
    return { ...meta, addedAt: added ? added.mtime.toISOString() : null, sentTo } satisfies LibraryEntry;
  }));
  // The same posting added more than once (same link, or same company and title) shows once: newest first, with
  // everyone it went to across those copies.
  const merged = new Map<string, LibraryEntry>();
  for (const entry of entries.filter((item): item is LibraryEntry => Boolean(item)).sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""))) {
    const key = entry.url ?? `${(entry.company ?? "").toLowerCase()}|${(entry.title ?? "").toLowerCase()}`;
    const seen = merged.get(key);
    if (seen) seen.sentTo = [...seen.sentTo, ...entry.sentTo];
    else merged.set(key, { ...entry, sentTo: [...entry.sentTo] });
  }
  return [...merged.values()];
}

/** The first other candidate with jobs waiting to run, so the queue can move on to them. */
export async function nextQueuedCandidate(root: string, activeId: string | null): Promise<{ id: string; name: string; waiting: number } | null> {
  const roster = await readRoster(root);
  for (const candidate of roster.candidates) {
    if (candidate.id === activeId || candidate.status === "archived") continue;
    const queue = await readJobQueue(await candidatePath(root, candidate.id));
    const waiting = queue.items.filter((item) => item.status === "queued" && (queue.autoRun || item.manual)).length;
    if (waiting && !queue.items.some((item) => item.status === "needs_attention")) return { id: candidate.id, name: candidate.displayName, waiting };
  }
  return null;
}
