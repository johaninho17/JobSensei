// Organizing the Jobs list: filters, grouping, saved views, tags, a company summary, and spotting a job that is
// already there. Pure functions over job summaries; the Jobs page (App.tsx JobsHome) only draws the results.
import { z } from "zod";
import type { JobFolderSummary } from "./schemas";
import { effectiveStatus, reachedInterview } from "./tracker";
import { SETTINGS_BANDS, bandFor, jobSettingsScore, type SettingsBand } from "./agy-behavior";

export const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"] as const;
export const FIT_BANDS = ["high", "mid", "low", "unrated"] as const;
export const GROUPINGS = ["none", "company", "role", "status", "work"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export type FitBand = (typeof FIT_BANDS)[number];
export type Grouping = (typeof GROUPINGS)[number];
/** The settings band a job's drafts were made under (#88); "none" when it has no drafts. */
export const JOB_SETTINGS_BANDS = [...SETTINGS_BANDS.map((band) => band.band), "none"] as const;
export type JobSettingsBand = SettingsBand | "none";

export const jobFacetsSchema = z.object({
  company: z.string().nullable().default(null),
  work: z.array(z.enum(WORK_MODES)).default([]),
  fit: z.array(z.enum(FIT_BANDS)).default([]),
  /** "yes": reached an interview; "no": did not. */
  interview: z.enum(["any", "yes", "no"]).default("any"),
  tags: z.array(z.string()).default([]),
  /** Settings band the drafts were made under (#88). */
  settings: z.array(z.enum(["strict", "careful", "balanced", "bold", "none"])).default([]),
});
export type JobFacets = z.infer<typeof jobFacetsSchema>;
export const NO_FACETS: JobFacets = { company: null, work: [], fit: [], interview: "any", tags: [], settings: [] };

/** A named combination the user saved: status tab, search text, filters, grouping, and sort. */
export const jobViewSchema = z.object({
  name: z.string().trim().min(1).max(40),
  tab: z.string(),
  query: z.string().default(""),
  facets: jobFacetsSchema,
  group: z.enum(GROUPINGS).default("none"),
  sort: z.string().default("added"),
});
export type JobView = z.infer<typeof jobViewSchema>;
export const jobViewsSchema = z.array(jobViewSchema).max(20);

const norm = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const companyKey = (value: string | null | undefined) => norm(value).replace(/\b(inc|llc|ltd|corp|corporation|co|company|labs?|technologies|the)\b/g, " ").replace(/\s+/g, " ").trim();

export const companyOf = (job: Pick<JobFolderSummary, "company" | "name">) => job.company?.trim() || job.name;
export const workModeOf = (job: Pick<JobFolderSummary, "role">): WorkMode => job.role?.workMode ?? "unknown";
/** The colored left edge of a job card (U78): interviewing or offer leaf, applied pine, a blocker must-have risk while
 * the job is still saved, otherwise none. Brass stays on the "due" badge (one brass element per screen, U2). */
export function jobEdgeOf(job: Pick<JobFolderSummary, "tracker" | "hasApplicationMaterials" | "mustHaves">): "leaf" | "accent" | "risk" | null {
  const status = effectiveStatus(job as JobFolderSummary);
  if (status === "interviewing" || status === "offer") return "leaf";
  if (status === "applied") return "accent";
  if (status === "saved" && (job.mustHaves ?? []).some((item) => item.status === "blocker")) return "risk";
  return null;
}

export function fitBandOf(job: Pick<JobFolderSummary, "rating">): FitBand {
  if (job.rating === null || job.rating === undefined) return "unrated";
  return job.rating >= 4 ? "high" : job.rating >= 3 ? "mid" : "low";
}

/** The band of the settings a job's drafts were made under: its stamped score, or today's default rules for drafts made
 * before scores were stamped (they followed those rules); "none" for a job without drafts (#88). */
export function settingsBandOf(job: Pick<JobFolderSummary, "settingsScore" | "hasApplicationMaterials">): JobSettingsBand {
  if (!job.settingsScore && !job.hasApplicationMaterials) return "none";
  return bandFor(jobSettingsScore(job.settingsScore).score).band;
}

/** Tags as the user typed them, trimmed, without a leading #, no repeats (case-insensitive), at most 12. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/^#/, "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, 12);
}

const SENIORITY = /\b(senior|sr|staff|principal|lead|junior|jr|associate|mid level|entry level|head of|i{1,3}|iv|v|[1-5])\b/g;
/** The kind of role, without level words: "Senior Solutions Engineer II" and "Solutions Engineer" are one family. */
export function roleFamily(title: string | null | undefined): string {
  const family = norm((title ?? "").replace(/\(.*?\)/g, " ").split(/\s[-–—|]\s|,/)[0]).replace(SENIORITY, " ").replace(/\s+/g, " ").trim();
  return family || "other";
}

export function matchesFacets(job: JobFolderSummary, facets: JobFacets): boolean {
  if (facets.company && companyKey(companyOf(job)) !== companyKey(facets.company)) return false;
  if (facets.work.length && !facets.work.includes(workModeOf(job))) return false;
  if (facets.fit.length && !facets.fit.includes(fitBandOf(job))) return false;
  if (facets.interview !== "any" && reachedInterview(job) !== (facets.interview === "yes")) return false;
  if (facets.settings?.length && !facets.settings.includes(settingsBandOf(job))) return false;
  if (facets.tags.length) {
    const own = new Set((job.tracker?.tags ?? []).map((tag) => tag.toLowerCase()));
    if (!facets.tags.every((tag) => own.has(tag.toLowerCase()))) return false;
  }
  return true;
}

export const facetsActive = (facets: JobFacets) => Number(Boolean(facets.company)) + facets.work.length + facets.fit.length + Number(facets.interview !== "any") + facets.tags.length + (facets.settings?.length ?? 0);

/** What the filter menus offer: each choice with how many jobs have it. */
export function facetOptions(jobs: JobFolderSummary[]): { companies: Array<{ name: string; count: number }>; tags: Array<{ name: string; count: number }>; work: Record<WorkMode, number>; fit: Record<FitBand, number>; settings: Record<JobSettingsBand, number> } {
  const companies = new Map<string, { name: string; count: number }>();
  const tags = new Map<string, { name: string; count: number }>();
  const work = { remote: 0, hybrid: 0, onsite: 0, unknown: 0 };
  const fit = { high: 0, mid: 0, low: 0, unrated: 0 };
  const settings: Record<JobSettingsBand, number> = { strict: 0, careful: 0, balanced: 0, bold: 0, none: 0 };
  for (const job of jobs) {
    const key = companyKey(companyOf(job));
    companies.set(key, { name: companies.get(key)?.name ?? companyOf(job), count: (companies.get(key)?.count ?? 0) + 1 });
    for (const tag of job.tracker?.tags ?? []) tags.set(tag.toLowerCase(), { name: tags.get(tag.toLowerCase())?.name ?? tag, count: (tags.get(tag.toLowerCase())?.count ?? 0) + 1 });
    work[workModeOf(job)] += 1;
    fit[fitBandOf(job)] += 1;
    settings[settingsBandOf(job)] += 1;
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return { companies: [...companies.values()].sort(byName), tags: [...tags.values()].sort(byName), work, fit, settings };
}

const STATUS_LABEL: Record<string, string> = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn" };
const WORK_LABEL: Record<WorkMode, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "Work setup not stated" };

/** Jobs in groups, keeping the order they came in; groups with more jobs first, then by name. */
export function groupJobs(jobs: JobFolderSummary[], by: Grouping): Array<{ key: string; label: string; jobs: JobFolderSummary[] }> {
  if (by === "none") return [{ key: "all", label: "", jobs }];
  const groups = new Map<string, { key: string; label: string; jobs: JobFolderSummary[] }>();
  for (const job of jobs) {
    const [key, label] = by === "company" ? [companyKey(companyOf(job)), companyOf(job)]
      : by === "role" ? [roleFamily(job.title), roleFamily(job.title).replace(/\b\w/g, (letter) => letter.toUpperCase())]
      : by === "status" ? [effectiveStatus(job), STATUS_LABEL[effectiveStatus(job)] ?? effectiveStatus(job)]
      : [workModeOf(job), WORK_LABEL[workModeOf(job)]];
    const group = groups.get(key) ?? { key, label, jobs: [] };
    group.jobs.push(job);
    groups.set(key, group);
  }
  const order = by === "status" ? Object.keys(STATUS_LABEL) : by === "work" ? [...WORK_MODES] : null;
  return [...groups.values()].sort((a, b) => order ? order.indexOf(a.key) - order.indexOf(b.key) : b.jobs.length - a.jobs.length || a.label.localeCompare(b.label));
}

/** Everything about one company across the user's jobs. */
export function companySummary(jobs: JobFolderSummary[], company: string) {
  const own = jobs.filter((job) => companyKey(companyOf(job)) === companyKey(company));
  const statuses: Record<string, number> = {};
  for (const job of own) statuses[effectiveStatus(job)] = (statuses[effectiveStatus(job)] ?? 0) + 1;
  const interviewed = own.filter(reachedInterview);
  const rated = own.filter((job) => job.rating !== null);
  return {
    name: own[0] ? companyOf(own[0]) : company,
    jobs: own.length,
    statuses: Object.entries(statuses).map(([status, count]) => ({ status, label: STATUS_LABEL[status] ?? status, count })),
    interviewed: interviewed.length,
    /** A job with interview prep: its folder holds the company research. */
    researchJobId: own.find((job) => job.interviewRoundCount > 0)?.id ?? null,
    averageFit: rated.length ? Math.round((rated.reduce((sum, job) => sum + (job.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
    lastAdded: own.map((job) => job.createdAt).sort().at(-1) ?? null,
  };
}

const urlKey = (value: string | null | undefined) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    const id = url.searchParams.get("gh_jid");
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/(apply|application)\/?$/i, "").replace(/\/+$/, "")}${id ? `?gh_jid=${id}` : ""}`.toLowerCase();
  } catch { return ""; }
};

/** A job the user already has: the same posting link, or the same company with the same title. */
export function findDuplicateJob(jobs: JobFolderSummary[], incoming: { url?: string | null; company?: string | null; title?: string | null }): JobFolderSummary | null {
  const link = urlKey(incoming.url);
  if (link) { const same = jobs.find((job) => urlKey(job.role?.source) === link); if (same) return same; }
  const company = companyKey(incoming.company);
  const title = norm(incoming.title);
  if (!company || !title) return null;
  return jobs.find((job) => companyKey(companyOf(job)) === company && norm(job.title) === title) ?? null;
}

/** How many of the jobs in view each quick filter keeps: the number on a filter equals the rows it shows. */
export function countWithin<J, F extends string>(jobs: J[], inView: (job: J) => boolean, filters: F[], matches: (job: J, filter: F) => boolean): Record<F, number> {
  const shown = jobs.filter(inView);
  return Object.fromEntries(filters.map((filter) => [filter, shown.filter((job) => matches(job, filter)).length])) as Record<F, number>;
}

/** Sort key for "Settings score": the stamped score; jobs without drafts last (#88). */
export function settingsSortKey(job: Pick<JobFolderSummary, "settingsScore" | "hasApplicationMaterials">): number {
  return settingsBandOf(job) === "none" ? -1 : jobSettingsScore(job.settingsScore).score;
}
