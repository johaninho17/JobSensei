// "Who is this for?" (Recruiter Edition, plan R5): how well a posting suits each candidate's targets, with a reason
// for every point, so the recruiter sees why a candidate is or isn't suggested. Pure, so the rules are tested alone.
import type { CandidateTargets } from "./schemas";
import { SENIORITY_LEVELS, type PostingRecord } from "./posting";

export type PostingFacts = Pick<PostingRecord, "title" | "company" | "location" | "url" | "pay" | "workSetup" | "seniority" | "workAuthorization">;
export type ExistingPosting = { jobId: string | null; url: string | null; company: string | null; title: string | null };
export type LibraryPosting = { id: string; title: string | null; company: string | null; location: string | null; url: string | null };
export type MatchReason = { good: boolean; text: string };
export type CandidateMatch = {
  score: number;
  /** Ticked by default in the picker. */
  suggested: boolean;
  /** Something that rules the candidate out (sponsorship). */
  blocker: string | null;
  /** The candidate already has this posting (a job or a queued item). */
  duplicate: string | null;
  reasons: MatchReason[];
};

const STOP = new Set(["and", "the", "for", "with", "of", "senior", "junior", "lead", "staff", "principal", "sr", "jr", "ii", "iii", "iv"]);
const words = (value: string) => value.toLowerCase().split(/[^a-z0-9+#]+/).filter((word) => word.length >= 2 && !STOP.has(word));
const key = (value: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const MODE_LABEL = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" } as const;

/** Yearly pay from a posted range (hourly × 2,080, monthly × 12); null when the posting gives none. */
export function yearlyPay(pay: PostingFacts["pay"]): { min: number | null; max: number | null } {
  if (!pay || (pay.currency && pay.currency !== "USD" && pay.currency !== "$")) return { min: null, max: null };
  const factor = pay.period === "hour" ? 2080 : pay.period === "month" ? 12 : 1;
  return { min: pay.min === null ? null : pay.min * factor, max: pay.max === null ? null : pay.max * factor };
}

const NO_SPONSORSHIP = /\b(?:no|not|unable to|cannot|can't|will not|won't|do not|does not)\b[^.]{0,40}\bsponsor|\bwithout (?:the need for |current or future )?(?:visa )?sponsorship|\bcitizens? only\b|\bmust be a u\.?s\.? citizen|\bsecurity clearance\b|\bclearance required\b/i;

/** Same company, ignoring legal suffixes and punctuation ("Northstar Labs, Inc." = "northstar labs"). */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/\b(?:inc|llc|ltd|corp|corporation|co|company|gmbh|plc)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
  const left = norm(a);
  const right = norm(b);
  return left.length >= 3 && right.length >= 3 && left === right;
}

/** `currentEmployer`: the employer the base resume lists as present; never applied to (recruiter plan R8 P3). */
export function matchCandidate(posting: PostingFacts, targets: CandidateTargets, existing: ExistingPosting[] = [], currentEmployer: string | null = null): CandidateMatch {
  const reasons: MatchReason[] = [];
  let score = 0;
  const title = posting.title ?? "";

  const duplicateOf = existing.find((item) => (posting.url && item.url && item.url.replace(/[?#].*$/, "").toLowerCase() === posting.url.replace(/[?#].*$/, "").toLowerCase())
    || (key(posting.company) && key(posting.title) && key(item.company) === key(posting.company) && key(item.title) === key(posting.title)));
  const duplicate = duplicateOf ? (duplicateOf.jobId ? `Already has this job (${duplicateOf.jobId})` : "Already queued for this posting") : null;

  if (targets.roles.length && title) {
    const titleWords = new Set(words(title));
    const best = targets.roles
      .map((role) => { const roleWords = words(role); const hits = roleWords.filter((word) => titleWords.has(word)).length; return { role, full: roleWords.length > 0 && hits === roleWords.length, hits }; })
      .sort((a, b) => Number(b.full) - Number(a.full) || b.hits - a.hits)[0]!;
    if (best.full) { score += 2; reasons.push({ good: true, text: `Title matches "${best.role}"` }); }
    else if (best.hits) { score += 1; reasons.push({ good: true, text: `Title is close to "${best.role}"` }); }
    else { score -= 2; reasons.push({ good: false, text: `Not one of their roles (${targets.roles.slice(0, 3).join(", ")})` }); }
  }

  const mode = posting.workSetup?.mode ?? null;
  if (mode && targets.workModes.length) {
    if (targets.workModes.includes(mode)) { score += 1; reasons.push({ good: true, text: `${MODE_LABEL[mode]} fits` }); }
    else { score -= 2; reasons.push({ good: false, text: `${MODE_LABEL[mode]}; they want ${targets.workModes.map((value) => MODE_LABEL[value].toLowerCase()).join(" or ")}` }); }
  }

  if (mode !== "remote" && posting.location && targets.locations.length) {
    const place = posting.location.toLowerCase();
    const near = targets.locations.find((location) => words(location).some((word) => word.length >= 3 && place.includes(word)));
    if (near) { score += 1; reasons.push({ good: true, text: `In ${near}` }); }
    else { score -= 1; reasons.push({ good: false, text: `Based in ${posting.location}; they want ${targets.locations.slice(0, 3).join(", ")}` }); }
  }

  if (posting.seniority && targets.level) {
    const gap = Math.abs(SENIORITY_LEVELS.indexOf(posting.seniority) - SENIORITY_LEVELS.indexOf(targets.level));
    if (gap <= 1) { score += 1; reasons.push({ good: true, text: `Level fits (${posting.seniority})` }); }
    else { score -= 1; reasons.push({ good: false, text: `${posting.seniority} role; they target ${targets.level}` }); }
  }

  const pay = yearlyPay(posting.pay);
  if (targets.salaryFloor && (pay.max ?? pay.min) !== null) {
    const top = (pay.max ?? pay.min)!;
    if (top >= targets.salaryFloor) { score += 1; reasons.push({ good: true, text: `Pays up to ${money(top)}, above their ${money(targets.salaryFloor)} floor` }); }
    else { score -= 2; reasons.push({ good: false, text: `Pays up to ${money(top)}; their floor is ${money(targets.salaryFloor)}` }); }
  }

  const skipped = targets.skipCompanies.find((company) => sameCompany(company, posting.company));
  const blocker = currentEmployer && sameCompany(currentEmployer, posting.company) ? `${posting.company} is their current employer`
    : skipped ? `${posting.company} is on their companies to skip`
    : targets.needsSponsorship && posting.workAuthorization && NO_SPONSORSHIP.test(posting.workAuthorization) ? "Needs sponsorship; this posting won't sponsor" : null;
  if (blocker) reasons.unshift({ good: false, text: blocker });
  if (duplicate) reasons.unshift({ good: false, text: duplicate });
  const hasTargets = Boolean(targets.roles.length || targets.workModes.length || targets.locations.length || targets.level || targets.salaryFloor);
  if (!hasTargets) reasons.push({ good: false, text: "No brief yet (Candidate → Brief)" });
  return { score, suggested: hasTargets && !blocker && !duplicate && score >= 1, blocker, duplicate, reasons };
}

export type CandidateSuggestion = CandidateMatch & { id: string; name: string; status: string };

/** A job in the cross-candidate pipeline. */
export type PipelineRow = import("./schemas").JobFolderSummary & { candidateId: string; candidateName: string };
